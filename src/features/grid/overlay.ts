/** Draws selection, copy marquee, references and other transient outlines. */
import type { FindHit } from '@/engine/commands/find';
import { mergeAt } from '@/engine/sheet';
import type { CellPos, Range, SelectionState, Sheet } from '@/types';
import type { TraceState } from '@/state/uiStore';
import type { FormulaRef } from './formulaRefs';
import { REF_COLORS_DARK, REF_COLORS_LIGHT, type GridPalette } from './gridPalette';
import { rangeBox, rangeBoxInPane, xOf, yOf, type Box, type Layout, type Pane } from './viewport';

export interface OverlayInput {
  ctx: CanvasRenderingContext2D;
  layout: Layout;
  dpr: number;
  sheet: Sheet;
  palette: GridPalette;
  selection: SelectionState;
  showSelection: boolean;
  editing: boolean;
  marquee: Range | null;
  marqueePhase: number;
  refs: FormulaRef[];
  /** Destination while dragging the fill handle or moving cells. */
  preview: { range: Range; kind: 'fill' | 'move' | 'clear' } | null;
  resize: { axis: 'row' | 'col'; at: number } | null;
  found: { hits: FindHit[]; current: FindHit | null } | null;
  traces: TraceState[];
  hoverCell: CellPos | null;
  spill: Range | null;
  painterRange: Range | null;
}

export function drawOverlay(o: OverlayInput): void {
  const { ctx, layout, dpr } = o;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const pane of layout.panes) {
    if (pane.w <= 0 || pane.h <= 0) continue;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath();
    // One extra pixel lets borders show along the header edge.
    ctx.rect(pane.x - 1.5, pane.y - 1.5, pane.w + 1.5, pane.h + 1.5);
    ctx.clip();
    drawPane(o, pane);
    ctx.restore();
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (o.resize) drawResizeGuide(o);
}

function snap(b: Box): Box {
  const x = Math.round(b.x);
  const y = Math.round(b.y);
  return { x, y, w: Math.round(b.x + b.w) - x, h: Math.round(b.y + b.h) - y };
}

function outline(ctx: CanvasRenderingContext2D, b: Box, width: number): void {
  // Aligned so the stroke straddles the gridline, as users expect.
  const off = width % 2 ? -0.5 : 0;
  ctx.lineWidth = width;
  ctx.strokeRect(b.x - 1 + (width === 2 ? 0.5 : 0) + off + 0.5, b.y - 1 + (width === 2 ? 0.5 : 0) + off + 0.5, b.w, b.h);
}

function drawPane(o: OverlayInput, pane: Pane): void {
  const { ctx, layout, palette, sheet } = o;
  const box = (r: Range): Box => snap(rangeBoxInPane(layout, pane, r));

  if (o.found) {
    for (const h of o.found.hits) {
      if (h.sheetId !== sheet.id) continue;
      const b = box({ r1: h.r, c1: h.c, r2: h.r, c2: h.c });
      if (b.x > pane.x + pane.w || b.y > pane.y + pane.h || b.x + b.w < pane.x || b.y + b.h < pane.y) continue;
      ctx.fillStyle = o.found.current && o.found.current.r === h.r && o.found.current.c === h.c ? palette.findCurrent : palette.find;
      ctx.fillRect(b.x, b.y, b.w - 1, b.h - 1);
    }
  }

  if (o.hoverCell && !o.editing) {
    const b = box({ r1: o.hoverCell.r, c1: o.hoverCell.c, r2: o.hoverCell.r, c2: o.hoverCell.c });
    ctx.fillStyle = palette.hover;
    ctx.fillRect(b.x, b.y, b.w - 1, b.h - 1);
  }

  if (o.showSelection) drawSelection(o, pane, box);

  if (o.spill && o.showSelection) {
    const b = box(o.spill);
    ctx.strokeStyle = palette.accent;
    ctx.globalAlpha = 0.75;
    outline(ctx, b, 1);
    ctx.globalAlpha = 1;
  }

  const colors = palette.dark ? REF_COLORS_DARK : REF_COLORS_LIGHT;
  for (const ref of o.refs) {
    if (ref.sheetId !== sheet.id) continue;
    const b = box(ref.range);
    const color = colors[ref.colorIndex % colors.length];
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.1;
    ctx.fillRect(b.x, b.y, b.w - 1, b.h - 1);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    outline(ctx, b, 2);
  }

  for (const t of o.traces) if (t.sheetId === sheet.id) drawTrace(o, t);

  if (o.painterRange) dashed(ctx, box(o.painterRange), palette.accent, 0);

  if (o.marquee) {
    const b = box(o.marquee);
    dashed(ctx, b, palette.accent, o.marqueePhase);
  }

  if (o.preview) {
    const b = box(o.preview.range);
    ctx.strokeStyle = palette.accent;
    if (o.preview.kind === 'move') {
      outline(ctx, b, 2);
      ctx.fillStyle = palette.selection;
      ctx.fillRect(b.x, b.y, b.w, b.h);
    } else {
      ctx.setLineDash([3, 2]);
      outline(ctx, b, 1);
      ctx.setLineDash([]);
    }
  }
}

function dashed(ctx: CanvasRenderingContext2D, b: Box, color: string, phase: number): void {
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.setLineDash([5, 4]);
  ctx.lineDashOffset = -phase;
  ctx.strokeRect(b.x, b.y, b.w - 1, b.h - 1);
  ctx.restore();
}

function drawSelection(o: OverlayInput, pane: Pane, box: (r: Range) => Box): void {
  const { ctx, palette, sheet, selection, layout } = o;
  const merge = mergeAt(sheet, selection.active.r, selection.active.c);
  const activeRange: Range = merge ?? { r1: selection.active.r, c1: selection.active.c, r2: selection.active.r, c2: selection.active.c };
  const active = box(activeRange);
  const multi = selection.ranges.length > 1;

  ctx.fillStyle = palette.selection;
  for (const r of selection.ranges) {
    const b = box(r);
    // Tint everything except the active cell.
    const path = new Path2D();
    path.rect(b.x - 1, b.y - 1, b.w, b.h);
    const inside = active.x >= b.x && active.y >= b.y && active.x + active.w <= b.x + b.w && active.y + active.h <= b.y + b.h;
    if (inside) path.rect(active.x, active.y, active.w - 1, active.h - 1);
    ctx.fill(path, 'evenodd');
  }

  ctx.strokeStyle = palette.accent;
  if (multi) {
    for (const r of selection.ranges) outline(ctx, box(r), 1);
    outline(ctx, active, 2);
    return;
  }
  const range = selection.ranges[0];
  const b = box(range);
  outline(ctx, b, 2);
  if (o.editing) return;

  // Fill handle, drawn once in the pane that owns the bottom-right corner.
  const hx = Math.round(xOf(layout, layout.cols.offset(range.c2 + 1) - 0.01));
  const hy = Math.round(yOf(layout, layout.rows.offset(range.r2 + 1) - 0.01));
  if (hx >= pane.x - 2 && hy >= pane.y - 2) {
    ctx.fillStyle = palette.canvas;
    ctx.fillRect(hx - 5, hy - 5, 9, 9);
    ctx.fillStyle = palette.accent;
    ctx.fillRect(hx - 4, hy - 4, 7, 7);
  }
}

function drawTrace(o: OverlayInput, t: TraceState): void {
  const { ctx, layout, palette } = o;
  const center = (r: Range): [number, number] => {
    const b = rangeBox(layout, { r1: r.r1, c1: r.c1, r2: r.r1, c2: r.c1 });
    return [b.x + Math.min(b.w / 2, 24), b.y + b.h / 2];
  };
  const here = center({ r1: t.from.r, c1: t.from.c, r2: t.from.r, c2: t.from.c });
  ctx.strokeStyle = palette.accent;
  ctx.fillStyle = palette.accent;
  for (const r of t.ranges) {
    const there = center(r);
    const [from, to] = t.kind === 'precedents' ? [there, here] : [here, there];
    if (r.r1 !== r.r2 || r.c1 !== r.c2) {
      const b = snap(rangeBox(layout, r));
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x - 0.5, b.y - 0.5, b.w, b.h);
    }
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(to[0], to[1]);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(from[0], from[1], 3, 0, Math.PI * 2);
    ctx.fill();
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
    ctx.save();
    ctx.translate(to[0], to[1]);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(2, 0);
    ctx.lineTo(-7, -4);
    ctx.lineTo(-7, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawResizeGuide(o: OverlayInput): void {
  const { ctx, layout, palette, resize } = o;
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  if (resize!.axis === 'col') {
    ctx.moveTo(Math.round(resize!.at) - 0.5, 0);
    ctx.lineTo(Math.round(resize!.at) - 0.5, layout.view.height);
  } else {
    ctx.moveTo(0, Math.round(resize!.at) - 0.5);
    ctx.lineTo(layout.view.width, Math.round(resize!.at) - 0.5);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}
