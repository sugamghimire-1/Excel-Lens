/** PDF export. Pages are painted by the grid renderer, with searchable text on top. */
import { colName } from '@/engine/address';
import { colAxis, rowAxis } from '@/engine/axis';
import { ConditionalEvaluator } from '@/engine/conditional';
import { effectiveStyle } from '@/engine/effective';
import { DEFAULT_FONT_SIZE } from '@/engine/measure';
import { formatValue } from '@/engine/numberFormat';
import { contentRange, extentRange } from '@/engine/sheet';
import { themeById } from '@/engine/themes';
import type { CalcEngine } from '@/formulas/calcEngine';
import type { Range, Sheet, Workbook } from '@/types';
import { APP_NAME } from '@/utils/brand';
import { LIGHT } from '../grid/gridPalette';
import { GridRenderer } from '../grid/renderer';
import { computeLayout } from '../grid/viewport';

export interface PdfOptions {
  scope: 'sheet' | 'workbook' | 'selection';
  paper: 'a4' | 'letter' | 'a3';
  orientation: 'portrait' | 'landscape';
  fit: 'width' | 'page' | 'actual';
  gridlines: boolean;
  headings: boolean;
  pageNumbers: boolean;
}

const PAPER: Record<PdfOptions['paper'], [number, number]> = { a4: [595.28, 841.89], letter: [612, 792], a3: [841.89, 1190.55] };
const MARGIN = 36;
const FOOTER = 18;
const PX_TO_PT = 0.75;
const MAX_PAGES = 400;

/** Part of a sheet that should be printed. */
export function printRange(sheet: Sheet, engine: CalcEngine): Range | null {
  const content = contentRange(sheet);
  const used = engine.usedRange(sheet.id);
  const ext = extentRange(sheet);
  if (!content && !sheet.charts.length && sheet.cells.size === 0) return null;
  let r2 = Math.max(content?.r2 ?? 0, Math.min(used?.r2 ?? 0, ext.r2));
  let c2 = Math.max(content?.c2 ?? 0, Math.min(used?.c2 ?? 0, ext.c2));
  const rows = rowAxis(sheet);
  const cols = colAxis(sheet);
  for (const ch of sheet.charts) {
    r2 = Math.max(r2, rows.indexAt(ch.y + ch.h));
    c2 = Math.max(c2, cols.indexAt(ch.x + ch.w));
  }
  return { r1: 0, c1: 0, r2, c2 };
}

/** Splits an axis into page-sized runs of whole rows or columns. */
export function paginate(axis: { size(i: number): number }, from: number, to: number, capacity: number): [number, number][] {
  const pages: [number, number][] = [];
  let start = from;
  let used = 0;
  for (let i = from; i <= to; i++) {
    const s = axis.size(i);
    if (used > 0 && used + s > capacity) {
      pages.push([start, i - 1]);
      start = i;
      used = 0;
    }
    used += s;
  }
  pages.push([start, to]);
  return pages;
}

export async function exportPdf(wb: Workbook, engine: CalcEngine, active: Sheet, selection: Range, o: PdfOptions, onProgress?: (page: number) => void): Promise<Uint8Array> {
  const [{ jsPDF }, { chartImage }] = await Promise.all([import('jspdf'), import('../charts/echarts')]);
  const landscape = o.orientation === 'landscape';
  const doc = new jsPDF({ unit: 'pt', format: o.paper, orientation: o.orientation, compress: true });
  doc.setProperties({ title: wb.name, creator: APP_NAME });
  const [pw, ph] = landscape ? [PAPER[o.paper][1], PAPER[o.paper][0]] : PAPER[o.paper];
  const areaW = pw - MARGIN * 2;
  const areaH = ph - MARGIN * 2 - FOOTER;
  const sheets = o.scope === 'workbook' ? wb.sheets.filter((s) => !s.hidden) : [active];
  let page = 0;

  for (const sheet of sheets) {
    const range = o.scope === 'selection' ? selection : printRange(sheet, engine);
    if (!range) continue;
    const rows = rowAxis(sheet);
    const cols = colAxis(sheet);
    const headW = o.headings ? 40 : 0;
    const headH = o.headings ? 22 : 0;
    const totalW = cols.offset(range.c2 + 1) - cols.offset(range.c1) + headW;
    const totalH = rows.offset(range.r2 + 1) - rows.offset(range.r1) + headH;
    let scale = PX_TO_PT;
    if (o.fit !== 'actual') scale = Math.min(PX_TO_PT, areaW / totalW);
    if (o.fit === 'page') scale = Math.min(scale, areaH / totalH);
    const colPages = paginate(cols, range.c1, range.c2, areaW / scale - headW);
    const rowPages = paginate(rows, range.r1, range.r2, areaH / scale - headH);
    const conditional = new ConditionalEvaluator(sheet, engine);
    const images = new Map(sheet.charts.map((c) => [c.id, chartImage(wb, engine, sheet, c, 2, 'jpeg')]));

    for (const [r1, r2] of rowPages) {
      for (const [c1, c2] of colPages) {
        if (++page > MAX_PAGES) throw new Error(`This would create more than ${MAX_PAGES} pages. Export a selection instead.`);
        onProgress?.(page);
        if (page > 1) doc.addPage(o.paper, o.orientation);
        const w = cols.offset(c2 + 1) - cols.offset(c1);
        const h = rows.offset(r2 + 1) - rows.offset(r1);
        const canvas = paintPage(wb, engine, sheet, conditional, cols.offset(c1), rows.offset(r1), w, h, o);
        const x0 = MARGIN + headW * scale;
        const y0 = MARGIN + headH * scale;
        doc.addImage(canvas.toDataURL('image/jpeg', 0.82), 'JPEG', x0, y0, w * scale, h * scale, undefined, 'FAST');

        doc.saveGraphicsState();
        for (const ch of sheet.charts) {
          const img = images.get(ch.id);
          const cx = ch.x - cols.offset(c1);
          const cy = ch.y - rows.offset(r1);
          if (!img || cx + ch.w <= 0 || cy + ch.h <= 0 || cx >= w || cy >= h) continue;
          doc.rect(x0, y0, w * scale, h * scale, null as unknown as string);
          doc.clip();
          doc.discardPath();
          doc.setDrawColor(222, 227, 235);
          doc.addImage(img, 'JPEG', x0 + cx * scale, y0 + cy * scale, ch.w * scale, ch.h * scale, undefined, 'FAST');
          doc.rect(x0 + cx * scale, y0 + cy * scale, ch.w * scale, ch.h * scale);
        }
        doc.restoreGraphicsState();

        // Invisible text layer, so the document can be searched and copied from.
        for (let r = r1; r <= r2; r++) {
          if (rows.isHidden(r)) continue;
          for (let c = c1; c <= c2; c++) {
            const v = engine.readCell(sheet.id, r, c);
            if (v === null || cols.isHidden(c)) continue;
            const style = effectiveStyle(sheet, r, c, themeById(wb.themeId));
            const text = formatValue(v, style?.numFmt).text;
            // Standard PDF fonts only cover Latin-1.
            if (!text || [...text].some((chr) => chr.charCodeAt(0) > 255)) continue;
            doc.setFontSize(Math.max(1, (style?.fontSize ?? DEFAULT_FONT_SIZE) * (scale / PX_TO_PT)));
            const right = typeof v === 'number';
            doc.text(text, x0 + (cols.offset(right ? c + 1 : c) - cols.offset(c1) + (right ? -5 : 5)) * scale, y0 + (rows.offset(r + 1) - rows.offset(r1) - 6) * scale, { renderingMode: 'invisible', align: right ? 'right' : 'left' });
          }
        }

        if (o.headings) drawHeadings(doc, sheet, r1, r2, c1, c2, x0, y0, headW, headH, scale);
        if (o.pageNumbers) {
          doc.setFontSize(8);
          doc.setTextColor(101, 113, 132);
          doc.text(`${wb.name}${o.scope === 'workbook' ? `, ${sheet.name}` : ''}`.replace(/[^\x20-\xff]/g, ''), MARGIN, ph - MARGIN + 6);
          doc.text(`Page ${page}`, pw - MARGIN, ph - MARGIN + 6, { align: 'right' });
          doc.setTextColor(0, 0, 0);
        }
      }
    }
  }
  if (page === 0) throw new Error('There is nothing to print. Add some data first.');
  return new Uint8Array(doc.output('arraybuffer'));
}

type Doc = import('jspdf').jsPDF;

function drawHeadings(doc: Doc, sheet: Sheet, r1: number, r2: number, c1: number, c2: number, x0: number, y0: number, headW: number, headH: number, scale: number): void {
  const rows = rowAxis(sheet);
  const cols = colAxis(sheet);
  doc.setFontSize(Math.max(5, 11 * scale));
  doc.setTextColor(86, 97, 118);
  doc.setDrawColor(217, 223, 231);
  for (let c = c1; c <= c2; c++) {
    const w = cols.size(c) * scale;
    if (!w) continue;
    const x = x0 + (cols.offset(c) - cols.offset(c1)) * scale;
    // Text drawing replaces the fill colour, so it is set for every box.
    doc.setFillColor(247, 249, 251);
    doc.rect(x, y0 - headH * scale, w, headH * scale, 'FD');
    doc.text(colName(c), x + w / 2, y0 - headH * scale * 0.32, { align: 'center' });
  }
  for (let r = r1; r <= r2; r++) {
    const h = rows.size(r) * scale;
    if (!h) continue;
    const y = y0 + (rows.offset(r) - rows.offset(r1)) * scale;
    doc.setFillColor(247, 249, 251);
    doc.rect(x0 - headW * scale, y, headW * scale, h, 'FD');
    doc.text(String(r + 1), x0 - (headW * scale) / 2, y + h * 0.66, { align: 'center' });
  }
  doc.setTextColor(0, 0, 0);
}

function paintPage(wb: Workbook, engine: CalcEngine, sheet: Sheet, conditional: ConditionalEvaluator, x: number, y: number, w: number, h: number, o: PdfOptions): HTMLCanvasElement {
  const dpr = w * h > 3_000_000 ? 1.5 : 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const flat: Sheet = { ...sheet, frozenRows: 0, frozenCols: 0 };
  const layout = computeLayout(flat, { width: w, height: h, zoom: 1, scrollX: x, scrollY: y, headerW: 0, headerH: 0 });
  new GridRenderer({
    ctx,
    layout,
    dpr,
    sheet: flat,
    engine,
    theme: themeById(wb.themeId),
    palette: LIGHT,
    conditional,
    showHeaders: false,
    showGridlines: o.gridlines,
    showFormulas: false,
    circleInvalid: false,
    editing: null,
    selection: [],
    hover: null,
    plain: true,
  }).draw();
  return canvas;
}
