/** Draws cells and headers on a canvas. Works in device pixels for crisp lines. */
import { cellKey, colName, isFullCol, isFullRow, MAX_COLS } from '@/engine/address';
import type { ConditionalEvaluator, ConditionalResult } from '@/engine/conditional';
import { effectiveStyle } from '@/engine/effective';
import { DEFAULT_FONT_SIZE, fontString, lineHeight, measureText, PT, wrapText } from '@/engine/measure';
import { CHECKBOX_FORMAT, formatGeneral, formatValue } from '@/engine/numberFormat';
import { mergeAt } from '@/engine/sheet';
import type { WorkbookTheme } from '@/engine/themes';
import { invalidAt } from '@/engine/validation';
import type { CalcEngine } from '@/formulas/calcEngine';
import { CellError, type BorderEdge, type CellScalar, type CellStyle, type HAlign, type Range, type Sheet, type Sparkline } from '@/types';
import { adaptFill, adaptLine, adaptText, type GridPalette } from './gridPalette';
import { visibleSpans, type Layout, type Pane, type Span } from './viewport';

const PAD = 5;
const ICON_W = 16;
/** How far to look left for text that overflows into view. */
const OVERFLOW_SCAN = 24;

export interface RenderInput {
  ctx: CanvasRenderingContext2D;
  layout: Layout;
  dpr: number;
  sheet: Sheet;
  engine: CalcEngine;
  theme: WorkbookTheme;
  palette: GridPalette;
  conditional: ConditionalEvaluator;
  showHeaders: boolean;
  showGridlines: boolean;
  showFormulas: boolean;
  circleInvalid: boolean;
  /** Cell hidden because it is being edited. */
  editing: { r: number; c: number } | null;
  selection: Range[];
  hover: { kind: 'row' | 'col' | 'corner'; index: number } | null;
  /** Omit interactive affordances such as filter buttons (print and PDF). */
  plain?: boolean;
}

interface CellView {
  r: number;
  c: number;
  x: number;
  y: number;
  w: number;
  h: number;
  value: CellScalar;
  text: string;
  textColor?: string;
  style: CellStyle | undefined;
  cond: ConditionalResult | null;
  link: boolean;
  note: boolean;
  merged?: boolean;
}

export class GridRenderer {
  private k = 1;
  private px = 1;

  constructor(private readonly input: RenderInput) {
    this.k = input.layout.view.zoom * input.dpr;
    this.px = Math.max(1, Math.round(input.dpr));
  }

  draw(): void {
    const { ctx, layout, dpr, palette } = this.input;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = palette.canvas;
    ctx.fillRect(0, 0, Math.ceil(layout.view.width * dpr), Math.ceil(layout.view.height * dpr));
    for (const pane of layout.panes) this.drawPane(pane);
    this.drawFreezeLines();
    if (this.input.showHeaders) this.drawHeaders();
  }

  /* ------------------------------------------------------------------ panes */

  private drawPane(pane: Pane): void {
    const { ctx, layout, dpr } = this.input;
    if (pane.w <= 0 || pane.h <= 0) return;
    const z = layout.view.zoom;
    const cols = visibleSpans(layout.cols, pane.sx, pane.w / z);
    const rows = visibleSpans(layout.rows, pane.sy, pane.h / z);
    if (!cols.length || !rows.length) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.round(pane.x * dpr), Math.round(pane.y * dpr), Math.round(pane.w * dpr), Math.round(pane.h * dpr));
    ctx.clip();

    const X = (px: number): number => Math.round(pane.x * dpr + (px - pane.sx) * this.k);
    const Y = (px: number): number => Math.round(pane.y * dpr + (px - pane.sy) * this.k);

    if (this.input.showGridlines) this.drawGridlines(cols, rows, X, Y);

    const cells = this.collect(cols, rows, X, Y);
    this.drawFills(cells);
    this.drawBars(cells);
    this.drawSparklines(pane, X, Y);
    this.drawText(cells, cols, X);
    this.drawBorders(cells);
    this.drawMarks(cells);
    ctx.restore();
  }

  private drawGridlines(cols: Span[], rows: Span[], X: (n: number) => number, Y: (n: number) => number): void {
    const { ctx, palette } = this.input;
    ctx.fillStyle = palette.line;
    const left = X(cols[0].start);
    const top = Y(rows[0].start);
    const lastCol = cols[cols.length - 1];
    const lastRow = rows[rows.length - 1];
    const right = X(lastCol.start + lastCol.size);
    const bottom = Y(lastRow.start + lastRow.size);
    for (const c of cols) ctx.fillRect(X(c.start + c.size) - this.px, top, this.px, bottom - top);
    for (const r of rows) ctx.fillRect(left, Y(r.start + r.size) - this.px, right - left, this.px);
  }

  /** Gathers everything that has something to draw. Merged areas yield one entry. */
  private collect(cols: Span[], rows: Span[], X: (n: number) => number, Y: (n: number) => number): CellView[] {
    const { sheet, layout } = this.input;
    const out: CellView[] = [];
    const seenMerges = new Set<Range>();
    const hasMerges = sheet.merges.length > 0;
    for (const row of rows) {
      const y = Y(row.start);
      const h = Y(row.start + row.size) - y;
      for (const col of cols) {
        if (hasMerges) {
          const m = mergeAt(sheet, row.index, col.index);
          if (m) {
            if (!seenMerges.has(m)) {
              seenMerges.add(m);
              const mx = X(layout.cols.offset(m.c1));
              const my = Y(layout.rows.offset(m.r1));
              const mw = X(layout.cols.offset(m.c2 + 1)) - mx;
              const mh = Y(layout.rows.offset(m.r2 + 1)) - my;
              const view = this.view(m.r1, m.c1, mx, my, mw, mh) ?? { r: m.r1, c: m.c1, x: mx, y: my, w: mw, h: mh, value: null, text: '', style: undefined, cond: null, link: false, note: false };
              out.push({ ...view, merged: true });
            }
            continue;
          }
        }
        const x = X(col.start);
        const view = this.view(row.index, col.index, x, y, X(col.start + col.size) - x, h);
        if (view) out.push(view);
      }
      // Text that starts left of the pane may overflow into it.
      const first = cols[0].index;
      for (let c = first - 1, n = 0; c >= 0 && n < OVERFLOW_SCAN; c--, n++) {
        const cell = sheet.cells.get(cellKey(row.index, c));
        if (cell === undefined || (cell.v === undefined && cell.f === undefined)) continue;
        if (mergeAt(sheet, row.index, c)) break;
        const x = X(layout.cols.offset(c));
        const view = this.view(row.index, c, x, y, X(layout.cols.offset(c + 1)) - x, h);
        if (view && view.text && typeof view.value === 'string' && !view.style?.wrap) out.push(view);
        break;
      }
    }
    return out;
  }

  private view(r: number, c: number, x: number, y: number, w: number, h: number): CellView | null {
    const { sheet, engine, theme, conditional, editing, showFormulas } = this.input;
    const cell = sheet.cells.get(cellKey(r, c));
    const cond = conditional.evaluate(r, c, sheet);
    const style = effectiveStyle(sheet, r, c, theme, cond);
    const value = engine.readCell(sheet.id, r, c);
    if (!cell && !style && !cond && value === null) return null;
    const hidden = editing !== null && editing.r === r && editing.c === c;
    let text = '';
    let textColor: string | undefined;
    if (!hidden && value !== null) {
      if (showFormulas && cell?.f !== undefined) text = cell.f;
      else {
        const f = formatValue(value, style?.numFmt);
        text = f.text;
        textColor = f.color;
      }
    }
    if (cond?.bar?.hideValue) text = '';
    return { r, c, x, y, w, h, value: hidden ? null : value, text, textColor, style, cond, link: cell?.link !== undefined, note: cell?.note !== undefined };
  }

  /* ------------------------------------------------------------------ fills */

  private drawFills(cells: CellView[]): void {
    const { ctx, palette } = this.input;
    for (const v of cells) {
      if (!v.style?.fill) {
        if (v.merged) {
          // Hide the gridlines that would show through a merged area.
          ctx.fillStyle = palette.canvas;
          ctx.fillRect(v.x, v.y, v.w - this.px, v.h - this.px);
        }
        continue;
      }
      ctx.fillStyle = adaptFill(v.style.fill, palette);
      // Cover the gridline on the top and left so fills look continuous.
      ctx.fillRect(v.x - this.px, v.y - this.px, v.w + this.px, v.h + this.px);
    }
  }

  private drawBars(cells: CellView[]): void {
    const { ctx, palette } = this.input;
    for (const v of cells) {
      const bar = v.cond?.bar;
      if (!bar) continue;
      const inset = Math.round(2 * this.k);
      const w = v.w - inset * 2 - this.px;
      const x = v.x + inset + Math.round(w * bar.from);
      const bw = Math.max(this.px, Math.round(w * (bar.to - bar.from)));
      ctx.globalAlpha = palette.dark ? 0.5 : 0.32;
      ctx.fillStyle = bar.negative ? palette.invalid : bar.color;
      ctx.beginPath();
      ctx.roundRect(x, v.y + inset, bw, v.h - inset * 2 - this.px, Math.min(3 * this.k, bw / 2));
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /* -------------------------------------------------------------- sparklines */

  private drawSparklines(pane: Pane, X: (n: number) => number, Y: (n: number) => number): void {
    const { sheet, layout } = this.input;
    const z = layout.view.zoom;
    for (const s of sheet.sparklines) {
      const m = mergeAt(sheet, s.r, s.c);
      const x1 = layout.cols.offset(s.c);
      const y1 = layout.rows.offset(s.r);
      const x2 = layout.cols.offset((m?.c2 ?? s.c) + 1);
      const y2 = layout.rows.offset((m?.r2 ?? s.r) + 1);
      if (x2 < pane.sx || y2 < pane.sy || x1 > pane.sx + pane.w / z || y1 > pane.sy + pane.h / z || x1 === x2 || y1 === y2) continue;
      this.drawSparkline(s, X(x1), Y(y1), X(x2) - X(x1), Y(y2) - Y(y1));
    }
  }

  private drawSparkline(s: Sparkline, x: number, y: number, w: number, h: number): void {
    const { ctx, sheet, engine, palette } = this.input;
    const vals: (number | null)[] = [];
    for (let r = s.range.r1; r <= s.range.r2; r++) {
      for (let c = s.range.c1; c <= s.range.c2; c++) {
        const v = engine.readCell(sheet.id, r, c);
        vals.push(typeof v === 'number' ? v : null);
      }
    }
    const ns = vals.filter((v): v is number => v !== null);
    if (!ns.length) return;
    const color = adaptLine(s.color, palette);
    const pad = Math.round(4 * this.k);
    const ix = x + pad;
    const iy = y + pad;
    const iw = w - pad * 2 - this.px;
    const ih = h - pad * 2 - this.px;
    if (iw < 4 || ih < 3) return;
    ctx.save();
    if (s.type === 'line') {
      const lo = Math.min(...ns);
      const hi = Math.max(...ns);
      const span = hi - lo || 1;
      const px = (i: number): number => ix + (vals.length === 1 ? iw / 2 : (iw * i) / (vals.length - 1));
      const py = (v: number): number => iy + ih - ((v - lo) / span) * ih;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6 * this.k;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      let pen = false;
      vals.forEach((v, i) => {
        if (v === null) {
          pen = false;
          return;
        }
        if (pen) ctx.lineTo(px(i), py(v));
        else ctx.moveTo(px(i), py(v));
        pen = true;
      });
      ctx.stroke();
      const last = vals.length - 1;
      if (vals[last] !== null) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px(last), py(vals[last]), 2.4 * this.k, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      const win = s.type === 'winloss';
      const lo = win ? -1 : Math.min(0, ...ns);
      const hi = win ? 1 : Math.max(0, ...ns);
      const span = hi - lo || 1;
      const slot = iw / vals.length;
      const bw = Math.max(1, slot * 0.68);
      const zero = iy + ih - ((0 - lo) / span) * ih;
      vals.forEach((v, i) => {
        if (v === null || (win && v === 0)) return;
        const val = win ? Math.sign(v) : v;
        const top = iy + ih - ((val - lo) / span) * ih;
        ctx.fillStyle = v < 0 ? palette.invalid : color;
        ctx.fillRect(ix + slot * i + (slot - bw) / 2, Math.min(top, zero), bw, Math.max(1, Math.abs(zero - top)));
      });
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------- text */

  private drawText(cells: CellView[], cols: Span[], X: (n: number) => number): void {
    const { ctx, palette, sheet, engine, layout } = this.input;
    ctx.textBaseline = 'alphabetic';
    const lastVisible = cols[cols.length - 1].index;
    for (const v of cells) {
      const isCheckbox = typeof v.value === 'boolean' && v.style?.numFmt === CHECKBOX_FORMAT;
      if (isCheckbox) {
        this.drawCheckbox(v, v.value as boolean);
        continue;
      }
      if (v.cond?.icon) this.drawIcon(v);
      if (!v.text) continue;
      const { style } = v;
      const font = fontString(style, this.k);
      ctx.font = font;
      const bg = style?.fill ? adaptFill(style.fill, palette) : palette.canvas;
      const explicit = v.textColor ?? style?.color;
      const base = explicit ?? (v.link ? palette.link : palette.text);
      ctx.fillStyle = adaptText(base, bg, palette);

      const iconSpace = v.cond?.icon ? ICON_W * this.k : 0;
      const pad = PAD * this.k;
      const indent = (style?.indent ?? 0) * 10 * this.k;
      const isNum = typeof v.value === 'number' && !this.input.showFormulas;
      const align: HAlign = style?.hAlign ?? (isNum ? 'right' : typeof v.value === 'boolean' || v.value instanceof CellError ? 'center' : 'left');
      const size = (style?.fontSize ?? DEFAULT_FONT_SIZE) * PT * this.k;
      const line = lineHeight(style?.fontSize) * this.k;
      const reserve = this.filterButtonAt(v.r, v.c) ? 18 * this.k : 0;
      const inner = v.w - pad * 2 - indent - iconSpace - reserve;

      let lines: string[];
      if (style?.wrap && !isNum) lines = wrapText(v.text, font, inner);
      else lines = v.text.includes('\n') ? [v.text.replace(/\n/g, ' ')] : [v.text];

      let clipL = v.x;
      let clipR = v.x + v.w - this.px;
      const width = measureText(lines[0], font);
      if (isNum && width > v.w - pad * 1.2 - indent - iconSpace) {
        lines = [this.fitNumber(v, font, v.w - pad * 1.2 - indent - iconSpace)];
      } else if (!style?.wrap && width > inner && typeof v.value === 'string' && !mergeAt(sheet, v.r, v.c)) {
        // Overflow into empty neighbours.
        const spare = width - inner;
        if (align === 'left' || align === 'center') {
          let need = align === 'center' ? spare / 2 : spare;
          for (let c = v.c + 1; need > 0 && c <= lastVisible + 1 && c < MAX_COLS; c++) {
            if (engine.readCell(sheet.id, v.r, c) !== null || mergeAt(sheet, v.r, c) || sheet.sparklines.some((s) => s.r === v.r && s.c === c)) break;
            const w = layout.cols.size(c) * this.k;
            clipR += w;
            need -= w;
          }
        }
        if (align === 'right' || align === 'center') {
          let need = align === 'center' ? spare / 2 : spare;
          for (let c = v.c - 1; need > 0 && c >= 0; c--) {
            if (engine.readCell(sheet.id, v.r, c) !== null || mergeAt(sheet, v.r, c)) break;
            const w = layout.cols.size(c) * this.k;
            clipL -= w;
            need -= w;
          }
        }
        if (this.input.showGridlines && (clipR > v.x + v.w || clipL < v.x) && !style?.fill) this.hideGridlines(v, clipL, clipR, width, align, pad + indent, X);
      }

      const blockH = lines.length * line;
      const vAlign = style?.vAlign ?? 'bottom';
      let y: number;
      if (vAlign === 'top' || (blockH > v.h && lines.length > 1)) y = v.y + 1.5 * this.k;
      else if (vAlign === 'middle') y = v.y + (v.h - blockH) / 2;
      else y = v.y + v.h - blockH - 1.5 * this.k;
      const ascent = (line - size) / 2 + size * 0.8;

      const needsClip = lines.length > 1 || clipR > v.x + v.w || clipL < v.x || width > inner - 1 || blockH > v.h;
      if (needsClip) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(clipL, v.y, clipR - clipL, v.h - this.px);
        ctx.clip();
      }
      lines.forEach((t, i) => {
        const w = measureText(t, font);
        let x: number;
        if (align === 'left') x = v.x + pad + indent + iconSpace;
        else if (align === 'right') x = v.x + v.w - pad - indent - reserve - w;
        else x = v.x + (v.w - reserve + iconSpace - w) / 2;
        const by = Math.round(y + i * line + ascent);
        ctx.fillText(t, Math.round(x), by);
        const underline = style?.underline || (v.link && !explicit);
        if (underline) ctx.fillRect(Math.round(x), by + Math.round(2 * this.k), Math.round(w), Math.max(1, Math.round(this.k)));
        if (style?.strike) ctx.fillRect(Math.round(x), by - Math.round(size * 0.3), Math.round(w), Math.max(1, Math.round(this.k)));
      });
      if (needsClip) ctx.restore();
    }
  }

  private hideGridlines(v: CellView, clipL: number, clipR: number, width: number, align: HAlign, pad: number, X: (n: number) => number): void {
    const { ctx, palette, layout } = this.input;
    const start = align === 'left' ? v.x + pad : align === 'right' ? v.x + v.w - pad - width : v.x + (v.w - width) / 2;
    const from = Math.max(clipL, start);
    const to = Math.min(clipR, start + width);
    const color = ctx.fillStyle;
    ctx.fillStyle = palette.canvas;
    let c = v.c;
    while (c > 0 && X(layout.cols.offset(c)) > from) c--;
    for (; c < layout.cols.count; c++) {
      const edge = X(layout.cols.offset(c + 1)) - this.px;
      if (edge >= to) break;
      if (edge >= from) ctx.fillRect(edge, v.y, this.px, v.h - this.px);
    }
    ctx.fillStyle = color;
  }

  /** Shortens a General number, or shows ### when the column is too narrow. */
  private fitNumber(v: CellView, font: string, width: number): string {
    const n = v.value as number;
    const code = v.style?.numFmt;
    if (!code || code === 'General') {
      for (let digits = 9; digits >= 0; digits--) {
        const t = formatGeneral(Number(n.toFixed(digits)));
        if (measureText(t, font) <= width) return t;
      }
      const sci = n.toExponential(1).replace('e', 'E');
      if (measureText(sci, font) <= width) return sci;
    }
    const hash = measureText('#', font);
    return '#'.repeat(Math.max(1, Math.floor(width / hash)));
  }

  private drawCheckbox(v: CellView, on: boolean): void {
    const { ctx, palette } = this.input;
    const s = Math.round(14 * this.k);
    const align = v.style?.hAlign ?? 'center';
    const x = align === 'left' ? v.x + PAD * this.k : align === 'right' ? v.x + v.w - s - PAD * this.k : Math.round(v.x + (v.w - s) / 2);
    const y = Math.round(v.y + (v.h - s) / 2);
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, s - 1, s - 1, 3.2 * this.k);
    if (on) {
      ctx.fillStyle = palette.accent;
      ctx.fill();
      ctx.strokeStyle = palette.dark ? '#0f1420' : '#ffffff';
      ctx.lineWidth = 1.8 * this.k;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(x + s * 0.26, y + s * 0.53);
      ctx.lineTo(x + s * 0.43, y + s * 0.69);
      ctx.lineTo(x + s * 0.75, y + s * 0.33);
      ctx.stroke();
    } else {
      ctx.strokeStyle = palette.headerText;
      ctx.lineWidth = this.px * 1.2;
      ctx.stroke();
    }
  }

  private drawIcon(v: CellView): void {
    const { ctx } = this.input;
    const icon = v.cond!.icon!;
    const colors = ['#d9463f', '#e5a50a', '#2e8b3d'];
    const s = 10 * this.k;
    const x = v.x + PAD * this.k;
    const y = v.y + (v.h - s) / 2;
    ctx.save();
    ctx.fillStyle = colors[icon.level];
    ctx.strokeStyle = colors[icon.level];
    ctx.beginPath();
    if (icon.set === 'lights') ctx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
    else if (icon.set === 'flags') {
      ctx.rect(x, y, 1.4 * this.k, s);
      ctx.moveTo(x + 2 * this.k, y);
      ctx.lineTo(x + s, y + s * 0.3);
      ctx.lineTo(x + 2 * this.k, y + s * 0.6);
    } else {
      // Up, level or down arrow, so direction is never carried by colour alone.
      ctx.translate(x + s / 2, y + s / 2);
      ctx.rotate(icon.level === 2 ? 0 : icon.level === 1 ? Math.PI / 2 : Math.PI);
      ctx.moveTo(0, -s / 2);
      ctx.lineTo(s / 2, 0);
      ctx.lineTo(s * 0.17, 0);
      ctx.lineTo(s * 0.17, s / 2);
      ctx.lineTo(-s * 0.17, s / 2);
      ctx.lineTo(-s * 0.17, 0);
      ctx.lineTo(-s / 2, 0);
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  }

  /* ---------------------------------------------------------------- borders */

  private drawBorders(cells: CellView[]): void {
    for (const v of cells) {
      const { style } = v;
      if (!style) continue;
      const x1 = v.x - this.px;
      const y1 = v.y - this.px;
      const x2 = v.x + v.w - this.px;
      const y2 = v.y + v.h - this.px;
      if (style.borderTop) this.line(style.borderTop, x1, y1, x2, y1);
      if (style.borderBottom) this.line(style.borderBottom, x1, y2, x2, y2);
      if (style.borderLeft) this.line(style.borderLeft, x1, y1, x1, y2);
      if (style.borderRight) this.line(style.borderRight, x2, y1, x2, y2);
    }
  }

  private line(edge: BorderEdge, x1: number, y1: number, x2: number, y2: number): void {
    const { ctx, palette } = this.input;
    ctx.fillStyle = adaptLine(edge.color, palette);
    const u = this.px;
    const horizontal = y1 === y2;
    const w = edge.style === 'medium' ? 2 * u : edge.style === 'thick' ? 3 * u : u;
    const off = edge.style === 'thick' ? -u : 0;
    const seg = (a: number, b: number, shift = 0, t = w): void => {
      if (horizontal) ctx.fillRect(a, y1 + off + shift, b - a, t);
      else ctx.fillRect(x1 + off + shift, a, t, b - a);
    };
    const from = horizontal ? x1 : y1;
    const to = (horizontal ? x2 : y2) + u;
    if (edge.style === 'double') {
      seg(from, to, -u, u);
      seg(from, to, u, u);
    } else if (edge.style === 'dashed' || edge.style === 'dotted') {
      const on = edge.style === 'dashed' ? 4 * u : u;
      for (let p = from; p < to; p += on * 2) seg(p, Math.min(to, p + on));
    } else seg(from, to);
  }

  /* ------------------------------------------------------------------ marks */

  filterButtonAt(r: number, c: number): boolean {
    const { filter } = this.input.sheet;
    return !this.input.plain && filter !== null && r === filter.range.r1 && c >= filter.range.c1 && c <= filter.range.c2;
  }

  private drawMarks(cells: CellView[]): void {
    const { ctx, palette, sheet, engine, circleInvalid, plain } = this.input;
    if (!plain) {
      for (const v of cells) {
        if (!v.note) continue;
        const s = 7 * this.k;
        ctx.fillStyle = palette.note;
        ctx.beginPath();
        ctx.moveTo(v.x + v.w - s - this.px, v.y);
        ctx.lineTo(v.x + v.w - this.px, v.y);
        ctx.lineTo(v.x + v.w - this.px, v.y + s);
        ctx.closePath();
        ctx.fill();
      }
    }
    const { filter } = sheet;
    if (filter && !plain) {
      for (const v of cells) if (this.filterButtonAt(v.r, v.c)) this.drawFilterButton(v, filter.criteria[v.c] !== undefined);
    }
    if (circleInvalid && sheet.validations.length) {
      ctx.strokeStyle = palette.invalid;
      ctx.lineWidth = 1.6 * this.k;
      for (const v of cells) {
        if (!invalidAt(sheet, engine, v.r, v.c)) continue;
        ctx.beginPath();
        ctx.ellipse(v.x + v.w / 2, v.y + v.h / 2, v.w / 2 - 2 * this.k, v.h / 2 - 1.5 * this.k, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  private drawFilterButton(v: CellView, active: boolean): void {
    const { ctx, palette } = this.input;
    const s = Math.round(16 * this.k);
    const x = v.x + v.w - s - Math.round(3 * this.k);
    const y = Math.round(v.y + (v.h - s) / 2);
    ctx.fillStyle = active ? palette.accent : palette.canvas;
    ctx.globalAlpha = active ? 1 : 0.92;
    ctx.beginPath();
    ctx.roundRect(x, y, s, s, 3.5 * this.k);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = active ? palette.accent : palette.headerLine;
    ctx.lineWidth = this.px;
    ctx.stroke();
    ctx.strokeStyle = active ? (palette.dark ? '#0f1420' : '#ffffff') : palette.headerText;
    ctx.lineWidth = 1.4 * this.k;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (active) {
      for (const [w, dy] of [[0.5, 0.34], [0.3, 0.52], [0.1, 0.7]] as const) {
        ctx.moveTo(x + s * (0.5 - w / 2), y + s * dy);
        ctx.lineTo(x + s * (0.5 + w / 2), y + s * dy);
      }
    } else {
      ctx.moveTo(x + s * 0.32, y + s * 0.43);
      ctx.lineTo(x + s * 0.5, y + s * 0.61);
      ctx.lineTo(x + s * 0.68, y + s * 0.43);
    }
    ctx.stroke();
  }

  /* ---------------------------------------------------------------- headers */

  private drawFreezeLines(): void {
    const { ctx, layout, dpr, palette, sheet } = this.input;
    ctx.fillStyle = palette.freeze;
    if (sheet.frozenRows) ctx.fillRect(0, Math.round((layout.view.headerH + layout.frozenH * layout.view.zoom) * dpr) - this.px, layout.view.width * dpr, this.px);
    if (sheet.frozenCols) ctx.fillRect(Math.round((layout.view.headerW + layout.frozenW * layout.view.zoom) * dpr) - this.px, 0, this.px, layout.view.height * dpr);
  }

  private drawHeaders(): void {
    const { ctx, layout, dpr, palette, selection, hover, sheet } = this.input;
    const { view } = layout;
    const hw = Math.round(view.headerW * dpr);
    const hh = Math.round(view.headerH * dpr);
    ctx.fillStyle = palette.headerBg;
    ctx.fillRect(0, 0, Math.ceil(view.width * dpr), hh);
    ctx.fillRect(0, 0, hw, Math.ceil(view.height * dpr));
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const font = (bold: boolean): string => `${bold ? 600 : 450} ${11.5 * dpr}px "IBM Plex Sans Variable", "Segoe UI", sans-serif`;

    const colState = (c: number): 0 | 1 | 2 => {
      let s: 0 | 1 | 2 = 0;
      for (const r of selection) if (c >= r.c1 && c <= r.c2) s = isFullCol(r) ? 2 : s === 2 ? 2 : 1;
      return s;
    };
    const rowState = (r: number): 0 | 1 | 2 => {
      let s: 0 | 1 | 2 = 0;
      for (const x of selection) if (r >= x.r1 && r <= x.r2) s = isFullRow(x) ? 2 : s === 2 ? 2 : 1;
      return s;
    };

    for (const pane of layout.panes) {
      if (pane.id === 'main' || pane.id === 'left') {
        ctx.save();
        ctx.beginPath();
        ctx.rect(Math.round(pane.x * dpr), 0, Math.round(pane.w * dpr), hh);
        ctx.clip();
        for (const col of visibleSpans(layout.cols, pane.sx, pane.w / view.zoom)) {
          const x = Math.round(pane.x * dpr + (col.start - pane.sx) * this.k);
          const w = Math.round(pane.x * dpr + (col.start + col.size - pane.sx) * this.k) - x;
          const state = colState(col.index);
          this.headerCell(x, 0, w, hh, state, hover?.kind === 'col' && hover.index === col.index);
          if (w > 14 * dpr) {
            ctx.fillStyle = state === 2 ? palette.headerFullText : state ? palette.headerActiveText : palette.headerText;
            ctx.font = font(state > 0);
            ctx.fillText(colName(col.index), x + w / 2, hh / 2 + 0.5 * dpr);
          }
          ctx.fillStyle = palette.headerLine;
          ctx.fillRect(x + w - this.px, 0, this.px, hh);
          if (col.index > 0 && layout.cols.isHidden(col.index - 1)) this.hiddenMark(x, 0, hh, true);
          if (state === 1) {
            ctx.fillStyle = palette.accent;
            ctx.fillRect(x - this.px, hh - 2 * this.px, w + this.px, 2 * this.px);
          }
        }
        ctx.restore();
      }
      if (pane.id === 'main' || pane.id === 'top') {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, Math.round(pane.y * dpr), hw, Math.round(pane.h * dpr));
        ctx.clip();
        for (const row of visibleSpans(layout.rows, pane.sy, pane.h / view.zoom)) {
          const y = Math.round(pane.y * dpr + (row.start - pane.sy) * this.k);
          const h = Math.round(pane.y * dpr + (row.start + row.size - pane.sy) * this.k) - y;
          const state = rowState(row.index);
          this.headerCell(0, y, hw, h, state, hover?.kind === 'row' && hover.index === row.index);
          if (h > 9 * dpr) {
            ctx.fillStyle = state === 2 ? palette.headerFullText : state ? palette.headerActiveText : sheet.filterHidden.size && sheet.filter && row.index > sheet.filter.range.r1 && row.index <= sheet.filter.range.r2 ? palette.accent : palette.headerText;
            ctx.font = font(state > 0);
            ctx.fillText(String(row.index + 1), hw / 2, y + h / 2 + 0.5 * dpr);
          }
          ctx.fillStyle = palette.headerLine;
          ctx.fillRect(0, y + h - this.px, hw, this.px);
          if (row.index > 0 && layout.rows.isHidden(row.index - 1) && !sheet.filterHidden.has(row.index - 1)) this.hiddenMark(0, y, hw, false);
          if (state === 1) {
            ctx.fillStyle = palette.accent;
            ctx.fillRect(hw - 2 * this.px, y - this.px, 2 * this.px, h + this.px);
          }
        }
        ctx.restore();
      }
    }
    ctx.textAlign = 'left';

    // Corner: selects everything.
    const all = selection.some((r) => isFullCol(r) && isFullRow(r));
    this.headerCell(0, 0, hw, hh, all ? 1 : 0, hover?.kind === 'corner');
    ctx.fillStyle = all ? palette.accent : palette.freeze;
    ctx.beginPath();
    ctx.moveTo(hw - 5 * dpr, hh - 13 * dpr);
    ctx.lineTo(hw - 5 * dpr, hh - 5 * dpr);
    ctx.lineTo(hw - 13 * dpr, hh - 5 * dpr);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = palette.headerLine;
    ctx.fillRect(0, hh - this.px, Math.ceil(view.width * dpr), this.px);
    ctx.fillRect(hw - this.px, 0, this.px, Math.ceil(view.height * dpr));
  }

  private headerCell(x: number, y: number, w: number, h: number, state: 0 | 1 | 2, hovered: boolean): void {
    const { ctx, palette } = this.input;
    ctx.fillStyle = state === 2 ? palette.headerFull : state === 1 ? palette.headerActive : hovered ? palette.headerHover : palette.headerBg;
    ctx.fillRect(x, y, w, h);
  }

  private hiddenMark(x: number, y: number, len: number, vertical: boolean): void {
    const { ctx, palette } = this.input;
    ctx.fillStyle = palette.headerText;
    if (vertical) {
      ctx.fillRect(x, y + len * 0.2, this.px, len * 0.6);
      ctx.fillRect(x - 3 * this.px, y + len * 0.2, this.px, len * 0.6);
    } else {
      ctx.fillRect(x + len * 0.2, y, len * 0.6, this.px);
      ctx.fillRect(x + len * 0.2, y - 3 * this.px, len * 0.6, this.px);
    }
  }
}

/** True when a point inside a cell box hits its filter button. */
export function hitsFilterButton(box: { x: number; y: number; w: number; h: number }, x: number, y: number, zoom: number): boolean {
  return x >= box.x + box.w - 20 * zoom && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
}
