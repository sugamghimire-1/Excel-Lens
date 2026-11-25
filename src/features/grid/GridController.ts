/**
 * Owns the canvases, scrolling and pointer interaction of the grid. React only
 * mounts it; all drawing happens in animation frames outside the render cycle.
 */
import { cellKey, cellRange, inRange, isFullCol, isFullRow, MAX_COLS, MAX_ROWS, normalizeRange } from '@/engine/address';
import { ConditionalEvaluator } from '@/engine/conditional';
import { CHECKBOX_FORMAT } from '@/engine/numberFormat';
import { baseStyle, expandToMerges, extentRange, mergeAt } from '@/engine/sheet';
import { themeById } from '@/engine/themes';
import * as actions from '@/state/actions';
import { canPoint, commitEdit, isEditing, pointAt, startEdit } from '@/state/editing';
import { activeSelection, primaryRange, sheetById } from '@/state/selectors';
import { extendTo, selectAll, selectCell, selectCols, selectRange, selectRows, setSelection } from '@/state/selection';
import { useUI } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import type { CellPos, Range, Sheet } from '@/types';
import { formulaRefs } from './formulaRefs';
import { DARK, LIGHT } from './gridPalette';
import { drawOverlay } from './overlay';
import { GridRenderer, hitsFilterButton } from './renderer';
import { computeLayout, HEADER_H, headerWidth, rangeBox, sheetX, sheetY, xOf, yOf, type Box, type Layout, type Viewport } from './viewport';

const MAX_SCROLL_PX = 15_000_000;
const EDGE = 4;

type Hit =
  | { area: 'corner' }
  | { area: 'col'; index: number; resize: number | null }
  | { area: 'row'; index: number; resize: number | null }
  | { area: 'cell'; r: number; c: number; part: 'body' | 'fill' | 'border' | 'filter' | 'checkbox' };

type Drag =
  | { kind: 'cells'; origin: CellPos }
  | { kind: 'rows'; origin: number }
  | { kind: 'cols'; origin: number }
  | { kind: 'resize'; axis: 'row' | 'col'; index: number; start: number; size: number; next: number }
  | { kind: 'fill'; source: Range; target: Range }
  | { kind: 'move'; source: Range; grab: CellPos; to: CellPos; copy: boolean }
  | { kind: 'point'; origin: CellPos }
  | { kind: 'touch'; x: number; y: number; hit: Hit };

export interface FrameInfo {
  layout: Layout;
  frame: number;
}

type FrameListener = () => void;

export class GridController {
  layout!: Layout;
  frame = 0;
  sheet!: Sheet;
  private dirty = true;
  private raf = 0;
  private drag: Drag | null = null;
  private hover: { kind: 'row' | 'col' | 'corner'; index: number } | null = null;
  private hoverCell: CellPos | null = null;
  private pointer = { x: 0, y: 0 };
  private autoScroll = 0;
  private conditional: ConditionalEvaluator | null = null;
  private conditionalFor: unknown = null;
  private marqueePhase = 0;
  private marqueeTimer = 0;
  private extentRows = 200;
  private extentCols = 40;
  private scale = { x: 1, y: 1 };
  private listeners = new Set<FrameListener>();
  private unsubs: (() => void)[] = [];
  private resizeObserver: ResizeObserver;
  private restoredFor = '';
  private lastZoom = 1;
  private hoverTimer = 0;
  /** Cell whose note is shown on hover. */
  hoverNote: CellPos | null = null;
  resizeLabel: { text: string; x: number; y: number } | null = null;

  constructor(
    private readonly scroller: HTMLDivElement,
    private readonly spacer: HTMLDivElement,
    private readonly stage: HTMLDivElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly overlay: HTMLCanvasElement,
    private readonly focusSink: () => void,
  ) {
    this.unsubs.push(
      useWorkbook.subscribe(() => this.invalidate()),
      useUI.subscribe(() => this.invalidate()),
    );
    this.resizeObserver = new ResizeObserver(() => this.invalidate());
    this.resizeObserver.observe(scroller);

    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      el.addEventListener(type, fn as EventListener, opts);
      this.unsubs.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    on(scroller, 'scroll', () => this.onScroll(), { passive: true });
    on(scroller, 'wheel', (e) => this.onWheel(e), { passive: false });
    on(overlay, 'pointerdown', (e) => this.onPointerDown(e));
    on(overlay, 'pointermove', (e) => this.onPointerMove(e));
    on(overlay, 'pointerup', (e) => this.onPointerUp(e));
    on(overlay, 'pointercancel', () => this.endDrag());
    on(overlay, 'pointerleave', () => this.clearHover());
    on(overlay, 'dblclick', (e) => this.onDoubleClick(e));
    on(overlay, 'contextmenu', (e) => this.onContextMenu(e));
    void document.fonts?.ready.then(() => this.invalidate());
    this.update();
    this.invalidate();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    clearInterval(this.autoScroll);
    clearInterval(this.marqueeTimer);
    clearTimeout(this.hoverTimer);
    this.resizeObserver.disconnect();
    for (const u of this.unsubs) u();
    this.listeners.clear();
  }

  /** React overlays subscribe to frames so they move in step with the canvas. */
  subscribe = (fn: FrameListener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getFrame = (): number => this.frame;

  invalidate(): void {
    this.dirty = true;
    if (!this.raf) {
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        if (this.dirty) this.render();
      });
    }
  }

  /* ---------------------------------------------------------------- layout */

  private viewport(): Viewport {
    const ui = useUI.getState();
    const { sheet } = this;
    const zoom = sheet.zoom;
    const headerH = ui.showHeadings ? HEADER_H : 0;
    const height = this.scroller.clientHeight;
    const scrollX = (this.scroller.scrollLeft * this.scale.x) / zoom;
    const scrollY = (this.scroller.scrollTop * this.scale.y) / zoom;
    const lastRow = this.layout ? this.layout.rows.indexAt(this.layout.frozenH + scrollY + height / zoom) : 100;
    return {
      width: this.scroller.clientWidth,
      height,
      zoom,
      scrollX,
      scrollY,
      headerW: ui.showHeadings ? headerWidth(lastRow) : 0,
      headerH,
    };
  }

  private update(): void {
    const { workbook } = useWorkbook.getState();
    const ui = useUI.getState();
    const sheet = sheetById(workbook, ui.activeSheetId);
    const switched = this.sheet === undefined || this.sheet.id !== sheet.id;
    this.sheet = sheet;
    if (switched) {
      this.extentRows = 200;
      this.extentCols = 40;
    }
    this.layout = computeLayout(sheet, this.viewport());
    this.updateExtent();
    if (switched || this.restoredFor !== sheet.id || this.lastZoom !== sheet.zoom) {
      // Opening a sheet or zooming keeps the same cells in view.
      this.restoredFor = sheet.id;
      this.lastZoom = sheet.zoom;
      const saved = ui.scrolls[sheet.id];
      this.scroller.scrollLeft = saved ? (saved.x * sheet.zoom) / this.scale.x : 0;
      this.scroller.scrollTop = saved ? (saved.y * sheet.zoom) / this.scale.y : 0;
      this.layout = computeLayout(sheet, this.viewport());
    }
  }

  /** The scrollable area grows with the data and as the user scrolls on. */
  private updateExtent(): void {
    const { sheet, layout } = this;
    const { view, rows, cols } = layout;
    const sel = activeSelection();
    const ext = extentCache(sheet);
    const lastR = rows.indexAt(layout.frozenH + view.scrollY + view.height / view.zoom);
    const lastC = cols.indexAt(layout.frozenW + view.scrollX + view.width / view.zoom);
    const capR = (n: number): number => (n >= MAX_ROWS ? 0 : n);
    const capC = (n: number): number => (n >= MAX_COLS ? 0 : n);
    const primary = sel.ranges[sel.ranges.length - 1];
    this.extentRows = Math.min(MAX_ROWS, Math.max(this.extentRows, ext.r2 + 60, capR(sel.active.r + 1) + 40, isFullCol(primary) ? 0 : primary.r2 + 10, lastR + 40));
    this.extentCols = Math.min(MAX_COLS, Math.max(this.extentCols, ext.c2 + 12, capC(sel.active.c + 1) + 10, isFullRow(primary) ? 0 : primary.c2 + 4, lastC + 8));
    for (const ch of sheet.charts) {
      this.extentRows = Math.max(this.extentRows, rows.indexAt(ch.y + ch.h) + 10);
      this.extentCols = Math.max(this.extentCols, cols.indexAt(ch.x + ch.w) + 4);
    }
    const width = view.headerW + cols.offset(this.extentCols) * view.zoom + 40;
    const height = view.headerH + rows.offset(this.extentRows) * view.zoom + 40;
    const w = Math.min(width, MAX_SCROLL_PX);
    const h = Math.min(height, MAX_SCROLL_PX);
    this.scale.x = width > MAX_SCROLL_PX ? (width - view.width) / (w - view.width) : 1;
    this.scale.y = height > MAX_SCROLL_PX ? (height - view.height) / (h - view.height) : 1;
    const sw = `${Math.ceil(w)}px`;
    const sh = `${Math.ceil(h)}px`;
    if (this.spacer.style.width !== sw) this.spacer.style.width = sw;
    if (this.spacer.style.height !== sh) this.spacer.style.height = sh;
    const stageW = `${view.width}px`;
    const stageH = `${view.height}px`;
    if (this.stage.style.width !== stageW) this.stage.style.width = stageW;
    if (this.stage.style.height !== stageH) this.stage.style.height = stageH;
  }

  /* ---------------------------------------------------------------- drawing */

  private render(): void {
    this.dirty = false;
    this.update();
    const { view } = this.layout;
    if (view.width < 2 || view.height < 2) return;
    const dpr = window.devicePixelRatio || 1;
    for (const el of [this.canvas, this.overlay]) {
      const w = Math.round(view.width * dpr);
      const h = Math.round(view.height * dpr);
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
        el.style.width = `${view.width}px`;
        el.style.height = `${view.height}px`;
      }
    }
    const { workbook, engine } = useWorkbook.getState();
    const ui = useUI.getState();
    const palette = ui.dark ? DARK : LIGHT;
    const { sheet } = this;
    if (this.conditionalFor !== sheet.conditional || !this.conditional) {
      this.conditional = new ConditionalEvaluator(sheet, engine);
      this.conditionalFor = sheet.conditional;
    }
    const sel = activeSelection();
    const editing = ui.edit && ui.edit.sheetId === sheet.id ? { r: ui.edit.r, c: ui.edit.c } : null;

    new GridRenderer({
      ctx: this.canvas.getContext('2d', { alpha: false })!,
      layout: this.layout,
      dpr,
      sheet,
      engine,
      theme: themeById(workbook.themeId),
      palette,
      conditional: this.conditional,
      showHeaders: ui.showHeadings,
      showGridlines: sheet.showGridlines,
      showFormulas: ui.showFormulas,
      circleInvalid: ui.circleInvalid,
      editing,
      selection: sel.ranges,
      hover: this.hover,
    }).draw();

    this.drawOverlayLayer();
    this.frame++;
    for (const fn of this.listeners) fn();
    this.manageMarquee(ui.marquee !== null && ui.marquee.sheetId === sheet.id);
  }

  private drawOverlayLayer(): void {
    const { workbook, engine } = useWorkbook.getState();
    const ui = useUI.getState();
    const { sheet } = this;
    const { edit } = ui;
    const sel = activeSelection();
    const dragging = this.drag;
    const preview =
      dragging?.kind === 'fill'
        ? { range: dragging.target, kind: 'fill' as const }
        : dragging?.kind === 'move'
          ? { range: moveTarget(dragging), kind: 'move' as const }
          : null;
    drawOverlay({
      ctx: this.overlay.getContext('2d')!,
      layout: this.layout,
      dpr: window.devicePixelRatio || 1,
      sheet,
      palette: ui.dark ? DARK : LIGHT,
      selection: sel,
      showSelection: !ui.selectedChart && (!edit || edit.sheetId === sheet.id),
      editing: edit !== null,
      marquee: ui.marquee?.sheetId === sheet.id ? ui.marquee.range : null,
      marqueePhase: this.marqueePhase,
      refs: edit ? formulaRefs(edit.text, edit.sheetId, workbook) : [],
      preview,
      resize: dragging?.kind === 'resize' ? { axis: dragging.axis, at: this.resizeGuide(dragging) } : null,
      found: ui.found ? { hits: ui.found.hits, current: ui.found.hits[ui.found.index] ?? null } : null,
      traces: ui.traces,
      hoverCell: this.hoverCell,
      spill: engine.spillAt(sheet.id, sel.active.r, sel.active.c)?.range ?? null,
      painterRange: ui.painter?.sheetId === sheet.id ? ui.painter.range : null,
    });
  }

  private manageMarquee(on: boolean): void {
    if (on && !this.marqueeTimer) {
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (still) return;
      this.marqueeTimer = window.setInterval(() => {
        this.marqueePhase = (this.marqueePhase + 1) % 9;
        this.drawOverlayLayer();
      }, 60);
    } else if (!on && this.marqueeTimer) {
      clearInterval(this.marqueeTimer);
      this.marqueeTimer = 0;
    }
  }

  private resizeGuide(d: Extract<Drag, { kind: 'resize' }>): number {
    const l = this.layout;
    return d.axis === 'col' ? xOf(l, l.cols.offset(d.index)) + d.next * l.view.zoom : yOf(l, l.rows.offset(d.index)) + d.next * l.view.zoom;
  }

  /* -------------------------------------------------------------- geometry */

  /** Cell rectangle in stage coordinates. */
  cellBox(r: number, c: number): Box {
    return rangeBox(this.layout, mergeAt(this.sheet, r, c) ?? cellRange(r, c));
  }

  pageRect(r: number, c: number): DOMRect | null {
    const b = this.cellBox(r, c);
    const host = this.stage.getBoundingClientRect();
    const { view } = this.layout;
    if (b.x + b.w < view.headerW || b.y + b.h < view.headerH || b.x > view.width || b.y > view.height) return null;
    return new DOMRect(host.left + b.x, host.top + b.y, b.w, b.h);
  }

  reveal(r: number, c: number): void {
    this.update();
    const { sheet } = this;
    const l = this.layout;
    const { view } = l;
    const z = view.zoom;
    const top = l.rows.offset(r);
    const left = l.cols.offset(c);
    const h = Math.min(l.rows.size(r), (view.height - view.headerH) / z - l.frozenH);
    const w = Math.min(l.cols.size(c), (view.width - view.headerW) / z - l.frozenW);
    if (r >= sheet.frozenRows) {
      const visible = (view.height - view.headerH) / z - l.frozenH;
      const y = top - l.frozenH;
      if (y < view.scrollY) this.scroller.scrollTop = (y * z) / this.scale.y;
      else if (y + h > view.scrollY + visible - 4 / z) this.scroller.scrollTop = ((y + h - visible + 8 / z) * z) / this.scale.y;
    }
    if (c >= sheet.frozenCols) {
      const visible = (view.width - view.headerW) / z - l.frozenW;
      const x = left - l.frozenW;
      if (x < view.scrollX) this.scroller.scrollLeft = (x * z) / this.scale.x;
      else if (x + w > view.scrollX + visible - 4 / z) this.scroller.scrollLeft = ((x + w - visible + 8 / z) * z) / this.scale.x;
    }
    this.invalidate();
  }

  pageRows(): number {
    const { view, frozenH } = this.layout;
    return Math.max(1, Math.floor(((view.height - view.headerH) / view.zoom - frozenH) / 22) - 1);
  }

  pageCols(): number {
    const { view, frozenW } = this.layout;
    return Math.max(1, Math.floor(((view.width - view.headerW) / view.zoom - frozenW) / 88) - 1);
  }

  center(): { x: number; y: number } {
    const { view, frozenW, frozenH } = this.layout;
    return { x: frozenW + view.scrollX + (view.width - view.headerW) / view.zoom / 2, y: frozenH + view.scrollY + (view.height - view.headerH) / view.zoom / 2 };
  }

  viewportSize(): { w: number; h: number } {
    const { view } = this.layout;
    return { w: view.width - view.headerW, h: view.height - view.headerH };
  }

  private cellAt(x: number, y: number): CellPos {
    const l = this.layout;
    return {
      r: l.rows.indexAt(Math.max(0, sheetY(l, Math.max(l.view.headerH, y)))),
      c: l.cols.indexAt(Math.max(0, sheetX(l, Math.max(l.view.headerW, x)))),
    };
  }

  private hitTest(x: number, y: number): Hit {
    const l = this.layout;
    const { view } = l;
    if (x < view.headerW && y < view.headerH) return { area: 'corner' };
    if (y < view.headerH) {
      const px = sheetX(l, x);
      const index = l.cols.indexAt(Math.max(0, px));
      return { area: 'col', index, resize: this.resizeTarget(l.cols, index, px, EDGE / view.zoom) };
    }
    if (x < view.headerW) {
      const px = sheetY(l, y);
      const index = l.rows.indexAt(Math.max(0, px));
      return { area: 'row', index, resize: this.resizeTarget(l.rows, index, px, EDGE / view.zoom) };
    }
    const p = this.cellAt(x, y);
    const merge = mergeAt(this.sheet, p.r, p.c);
    const r = merge?.r1 ?? p.r;
    const c = merge?.c1 ?? p.c;
    const sel = activeSelection();
    const ui = useUI.getState();
    if (sel.ranges.length === 1 && !isEditing() && !ui.selectedChart && !ui.painter) {
      const range = sel.ranges[0];
      const b = rangeBox(l, range);
      const rx = xOf(l, l.cols.offset(range.c2 + 1) - 0.01);
      const by = yOf(l, l.rows.offset(range.r2 + 1) - 0.01);
      if (Math.abs(x - rx) <= 5 && Math.abs(y - by) <= 5) return { area: 'cell', r, c, part: 'fill' };
      const nearX = Math.abs(x - b.x) <= 3 || Math.abs(x - rx) <= 3;
      const nearY = Math.abs(y - b.y) <= 3 || Math.abs(y - by) <= 3;
      const insideX = x >= b.x - 3 && x <= rx + 3;
      const insideY = y >= b.y - 3 && y <= by + 3;
      if ((nearX && insideY) || (nearY && insideX)) return { area: 'cell', r, c, part: 'border' };
    }
    const { filter } = this.sheet;
    const box = this.cellBox(r, c);
    if (filter && r === filter.range.r1 && c >= filter.range.c1 && c <= filter.range.c2 && hitsFilterButton(box, x, y, view.zoom)) return { area: 'cell', r, c, part: 'filter' };
    const cell = this.sheet.cells.get(cellKey(r, c));
    if (typeof cell?.v === 'boolean' && baseStyle(this.sheet, r, c)?.numFmt === CHECKBOX_FORMAT) {
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      if (Math.abs(x - cx) <= 10 * view.zoom && Math.abs(y - cy) <= 10 * view.zoom) return { area: 'cell', r, c, part: 'checkbox' };
    }
    return { area: 'cell', r, c, part: 'body' };
  }

  /** Which row or column a header position resizes, if any. */
  private resizeTarget(axis: Layout['rows'], index: number, px: number, tolerance: number): number | null {
    const start = axis.offset(index);
    const end = start + axis.size(index);
    if (end - px <= tolerance) return index;
    if (px - start <= tolerance && index > 0) {
      // Just right of a hidden run: dragging reveals the hidden item.
      return axis.isHidden(index - 1) ? index - 1 : axis.prevVisible(index - 1);
    }
    return null;
  }

  /* ----------------------------------------------------------------- events */

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const host = this.stage.getBoundingClientRect();
    return { x: e.clientX - host.left, y: e.clientY - host.top };
  }

  private onScroll(): void {
    const ui = useUI.getState();
    const { sheet } = this;
    const x = (this.scroller.scrollLeft * this.scale.x) / sheet.zoom;
    const y = (this.scroller.scrollTop * this.scale.y) / sheet.zoom;
    ui.scrolls[sheet.id] = { x, y };
    if (ui.filterMenu || ui.listMenu) ui.set({ filterMenu: null, listMenu: null });
    this.setHoverNote(null);
    this.invalidate();
  }

  private onWheel(e: WheelEvent): void {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const { x, y } = this.local(e);
    const before = { x: sheetX(this.layout, x), y: sheetY(this.layout, y) };
    const steps = Math.max(-1, Math.min(1, -e.deltaY / 60));
    const old = this.sheet.zoom;
    actions.setZoom(old * (1 + steps * 0.1));
    this.update();
    const z = this.sheet.zoom;
    if (z === old) return;
    // Keep the point under the cursor in place.
    const l = this.layout;
    if (before.x > l.frozenW) this.scroller.scrollLeft = ((before.x - l.frozenW) * z - (x - l.view.headerW - l.frozenW * z)) / this.scale.x;
    if (before.y > l.frozenH) this.scroller.scrollTop = ((before.y - l.frozenH) * z - (y - l.view.headerH - l.frozenH * z)) / this.scale.y;
    this.invalidate();
  }

  private onPointerDown(e: PointerEvent): void {
    const { x, y } = this.local(e);
    this.pointer = { x, y };
    const hit = this.hitTest(x, y);
    const ui = useUI.getState();
    if (ui.menu || ui.filterMenu || ui.listMenu || ui.noteEditor) ui.set({ menu: null, filterMenu: null, listMenu: null, noteEditor: null });
    if (e.button === 2) return;
    if (e.button !== 0) return;
    if (e.pointerType === 'touch') {
      this.drag = { kind: 'touch', x, y, hit };
      return;
    }
    // Keep focus in the keyboard sink.
    e.preventDefault();

    if (isEditing()) {
      if (hit.area === 'cell' && canPoint(ui.edit)) {
        const origin = e.shiftKey && ui.edit?.point ? ui.edit.point.anchor : { r: hit.r, c: hit.c };
        pointAt(origin, { r: hit.r, c: hit.c });
        this.beginDrag(e, { kind: 'point', origin });
        return;
      }
      if (!commitEdit()) return;
    }
    this.focusSink();
    if (ui.selectedChart) ui.set({ selectedChart: null });
    this.press(hit, e);
  }

  private press(hit: Hit, e: PointerEvent): void {
    const add = e.ctrlKey || e.metaKey;
    const { sheet } = this;
    if (hit.area === 'corner') {
      const sel = activeSelection();
      setSelection({ active: sel.active, ranges: [{ r1: 0, c1: 0, r2: MAX_ROWS - 1, c2: MAX_COLS - 1 }] }, { reveal: false });
      return;
    }
    if (hit.area === 'col' || hit.area === 'row') {
      if (hit.resize !== null) {
        const axis = hit.area;
        const size = axis === 'col' ? this.layout.cols.size(hit.resize) : this.layout.rows.size(hit.resize);
        this.beginDrag(e, { kind: 'resize', axis, index: hit.resize, start: axis === 'col' ? this.pointer.x : this.pointer.y, size, next: size });
        return;
      }
      if (hit.area === 'col') {
        const origin = e.shiftKey ? activeSelection().active.c : hit.index;
        selectCols(origin, hit.index, { add, active: origin });
        this.beginDrag(e, { kind: 'cols', origin });
      } else {
        const origin = e.shiftKey ? activeSelection().active.r : hit.index;
        selectRows(origin, hit.index, { add, active: origin });
        this.beginDrag(e, { kind: 'rows', origin });
      }
      return;
    }

    const { r, c } = hit;
    if (hit.part === 'filter') {
      selectCell(r, c, { reveal: false });
      const rect = this.pageRect(r, c);
      if (rect) useUI.getState().set({ filterMenu: { col: c, x: rect.right, y: rect.bottom } });
      return;
    }
    if (hit.part === 'fill') {
      const source = primaryRange();
      this.beginDrag(e, { kind: 'fill', source, target: source });
      return;
    }
    if (hit.part === 'border' && !e.shiftKey) {
      const source = primaryRange();
      if (!isFullCol(source) && !isFullRow(source)) {
        const p = this.cellAt(this.pointer.x, this.pointer.y);
        const grab = { r: Math.max(source.r1, Math.min(source.r2, p.r)), c: Math.max(source.c1, Math.min(source.c2, p.c)) };
        this.beginDrag(e, { kind: 'move', source, grab, to: { r: source.r1, c: source.c1 }, copy: add });
        return;
      }
    }
    if (hit.part === 'checkbox') {
      selectCell(r, c, { reveal: false });
      actions.toggleCheckbox();
      return;
    }
    const cell = sheet.cells.get(cellKey(r, c));
    if (add && cell?.link) {
      actions.followLink(cell.link);
      return;
    }
    if (e.shiftKey) {
      extendTo({ r, c }, false);
      this.beginDrag(e, { kind: 'cells', origin: activeSelection().active });
      return;
    }
    selectCell(r, c, { add, reveal: false });
    this.beginDrag(e, { kind: 'cells', origin: { r, c } });
  }

  private beginDrag(e: PointerEvent, drag: Drag): void {
    this.drag = drag;
    this.hoverCell = null;
    try {
      this.overlay.setPointerCapture(e.pointerId);
    } catch {
      // The pointer may already be gone; dragging still works inside the canvas.
    }
    clearInterval(this.autoScroll);
    this.autoScroll = window.setInterval(() => this.scrollWhileDragging(), 30);
    this.invalidate();
  }

  private onPointerMove(e: PointerEvent): void {
    const { x, y } = this.local(e);
    this.pointer = { x, y };
    if (!this.drag) {
      this.updateHover(x, y);
      return;
    }
    if (this.drag.kind === 'touch') return;
    if (this.drag.kind === 'move') this.drag.copy = e.ctrlKey || e.metaKey;
    this.continueDrag();
  }

  private continueDrag(): void {
    const { drag, pointer, layout: l } = this;
    if (!drag) return;
    const { x, y } = pointer;
    switch (drag.kind) {
      case 'cells': {
        const p = this.cellAt(x, y);
        const range = expandToMerges(this.sheet, normalizeRange(drag.origin, p));
        const sel = activeSelection();
        const last = primaryRange(sel);
        if (range.r1 !== last.r1 || range.r2 !== last.r2 || range.c1 !== last.c1 || range.c2 !== last.c2) {
          setSelection({ active: sel.active, ranges: [...sel.ranges.slice(0, -1), range] }, { reveal: false });
        }
        break;
      }
      case 'cols': {
        const index = this.cellAt(x, l.view.headerH + 1).c;
        const sel = activeSelection();
        setSelection({ active: sel.active, ranges: [...sel.ranges.slice(0, -1), { r1: 0, r2: MAX_ROWS - 1, c1: Math.min(drag.origin, index), c2: Math.max(drag.origin, index) }] }, { reveal: false });
        break;
      }
      case 'rows': {
        const index = this.cellAt(l.view.headerW + 1, y).r;
        const sel = activeSelection();
        setSelection({ active: sel.active, ranges: [...sel.ranges.slice(0, -1), { c1: 0, c2: MAX_COLS - 1, r1: Math.min(drag.origin, index), r2: Math.max(drag.origin, index) }] }, { reveal: false });
        break;
      }
      case 'resize': {
        const at = drag.axis === 'col' ? x : y;
        drag.next = Math.max(0, Math.round(drag.size + (at - drag.start) / l.view.zoom));
        this.resizeLabel = { text: `${drag.axis === 'col' ? 'Width' : 'Height'}: ${drag.next} px`, x: x + 12, y: y + (drag.axis === 'col' ? 14 : 8) };
        this.invalidate();
        break;
      }
      case 'fill': {
        const p = this.cellAt(x, y);
        const s = drag.source;
        const down = p.r - s.r2;
        const up = s.r1 - p.r;
        const right = p.c - s.c2;
        const left = s.c1 - p.c;
        const best = Math.max(down, up, right, left);
        let target = s;
        if (best > 0) {
          if (best === down) target = { ...s, r2: p.r };
          else if (best === up) target = { ...s, r1: p.r };
          else if (best === right) target = { ...s, c2: p.c };
          else target = { ...s, c1: p.c };
        } else if (inRange(s, p.r, p.c) && (p.r < s.r2 || p.c < s.c2)) {
          // Dragging back over the selection clears the cells left behind.
          target = s.r2 - p.r >= s.c2 - p.c ? { ...s, r2: p.r } : { ...s, c2: p.c };
        }
        drag.target = target;
        this.invalidate();
        break;
      }
      case 'move': {
        const p = this.cellAt(x, y);
        const { source: s, grab } = drag;
        drag.to = {
          r: Math.max(0, Math.min(MAX_ROWS - 1 - (s.r2 - s.r1), p.r - (grab.r - s.r1))),
          c: Math.max(0, Math.min(MAX_COLS - 1 - (s.c2 - s.c1), p.c - (grab.c - s.c1))),
        };
        this.overlay.style.cursor = drag.copy ? 'copy' : 'move';
        this.invalidate();
        break;
      }
      case 'point':
        pointAt(drag.origin, this.cellAt(x, y));
        break;
      default:
        break;
    }
  }

  private scrollWhileDragging(): void {
    const { drag, pointer, layout: l, sheet } = this;
    if (!drag || drag.kind === 'resize' || drag.kind === 'touch') return;
    const { view } = l;
    const left = view.headerW + l.frozenW * view.zoom;
    const top = view.headerH + l.frozenH * view.zoom;
    const speed = (d: number): number => Math.sign(d) * Math.min(60, 6 + Math.abs(d) * 0.5);
    let dx = 0;
    let dy = 0;
    if (drag.kind !== 'rows') {
      if (pointer.x > view.width - 4) dx = speed(pointer.x - view.width + 4);
      else if (pointer.x < (sheet.frozenCols ? view.headerW : left)) dx = speed(pointer.x - left);
    }
    if (drag.kind !== 'cols') {
      if (pointer.y > view.height - 4) dy = speed(pointer.y - view.height + 4);
      else if (pointer.y < (sheet.frozenRows ? view.headerH : top)) dy = speed(pointer.y - top);
    }
    if (!dx && !dy) return;
    this.scroller.scrollLeft += dx;
    this.scroller.scrollTop += dy;
    this.update();
    this.continueDrag();
  }

  private onPointerUp(e: PointerEvent): void {
    const { drag } = this;
    if (drag?.kind === 'touch') {
      const { x, y } = this.local(e);
      this.drag = null;
      if (Math.abs(x - drag.x) > 10 || Math.abs(y - drag.y) > 10) return;
      this.tap(drag.hit);
      return;
    }
    this.endDrag();
    if (!drag) return;
    const ui = useUI.getState();
    switch (drag.kind) {
      case 'resize':
        if (drag.next !== drag.size) actions.resizeAxis(drag.axis, drag.index, drag.next);
        break;
      case 'fill': {
        const { source: s, target: t } = drag;
        if (t.r1 === s.r1 && t.r2 === s.r2 && t.c1 === s.c1 && t.c2 === s.c2) break;
        const shrunk = t.r2 - t.r1 < s.r2 - s.r1 || t.c2 - t.c1 < s.c2 - s.c1;
        if (shrunk) {
          const rest: Range = t.r2 < s.r2 ? { ...s, r1: t.r2 + 1 } : { ...s, c1: t.c2 + 1 };
          selectRange(rest);
          actions.clear('contents');
          selectRange(t);
        } else actions.fillTo(t, { increment: e.ctrlKey || e.metaKey });
        break;
      }
      case 'move':
        if (drag.to.r !== drag.source.r1 || drag.to.c !== drag.source.c1) actions.moveCells(drag.source, drag.to.r, drag.to.c, drag.copy);
        break;
      case 'cells':
      case 'rows':
      case 'cols':
        if (ui.painter) actions.applyPainter(primaryRange());
        break;
      default:
        break;
    }
    this.updateHover(this.pointer.x, this.pointer.y);
  }

  /** Touch: tap selects, tapping the selected cell again edits it. */
  private tap(hit: Hit): void {
    if (isEditing() && !commitEdit()) return;
    if (hit.area === 'corner') {
      selectAll();
      return;
    }
    if (hit.area === 'col') {
      selectCols(hit.index, hit.index);
      return;
    }
    if (hit.area === 'row') {
      selectRows(hit.index, hit.index);
      return;
    }
    if (hit.part === 'filter') {
      const rect = this.pageRect(hit.r, hit.c);
      if (rect) useUI.getState().set({ filterMenu: { col: hit.c, x: rect.right, y: rect.bottom } });
      return;
    }
    if (hit.part === 'checkbox') {
      selectCell(hit.r, hit.c);
      actions.toggleCheckbox();
      return;
    }
    const { active } = activeSelection();
    const again = active.r === hit.r && active.c === hit.c;
    selectCell(hit.r, hit.c);
    if (useUI.getState().painter) actions.applyPainter(primaryRange());
    else if (again) startEdit({ mode: 'edit' });
    this.focusSink();
  }

  /** Drags the touch handle at the corner of the selection. */
  touchExtend(clientX: number, clientY: number): void {
    const { x, y } = this.local({ clientX, clientY });
    extendTo(this.cellAt(x, y), false);
  }

  private endDrag(): void {
    this.drag = null;
    this.resizeLabel = null;
    clearInterval(this.autoScroll);
    this.overlay.style.cursor = '';
    this.invalidate();
  }

  private onDoubleClick(e: MouseEvent): void {
    const { x, y } = this.local(e);
    const hit = this.hitTest(x, y);
    if (hit.area === 'col' || hit.area === 'row') {
      if (hit.resize !== null) actions.autoFit(hit.area, hit.resize);
      return;
    }
    if (hit.area !== 'cell') return;
    if (hit.part === 'fill') {
      actions.fillToData();
      return;
    }
    if (hit.part === 'filter' || hit.part === 'checkbox' || useUI.getState().painter) return;
    if (isEditing()) return;
    startEdit({ mode: 'edit', origin: 'cell' });
    this.focusSink();
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    if (isEditing() && !commitEdit()) return;
    const { x, y } = this.local(e);
    const hit = this.hitTest(x, y);
    const sel = activeSelection();
    const ui = useUI.getState();
    const at = { x: e.clientX, y: e.clientY };
    if (hit.area === 'col') {
      if (!sel.ranges.some((r) => isFullCol(r) && hit.index >= r.c1 && hit.index <= r.c2)) selectCols(hit.index, hit.index);
      ui.set({ menu: { type: 'col', ...at } });
    } else if (hit.area === 'row') {
      if (!sel.ranges.some((r) => isFullRow(r) && hit.index >= r.r1 && hit.index <= r.r2)) selectRows(hit.index, hit.index);
      ui.set({ menu: { type: 'row', ...at } });
    } else if (hit.area === 'cell') {
      if (!sel.ranges.some((r) => inRange(r, hit.r, hit.c))) selectCell(hit.r, hit.c, { reveal: false });
      const range = primaryRange();
      ui.set({ menu: { type: isFullCol(range) ? 'col' : isFullRow(range) ? 'row' : 'cell', ...at } });
    }
    this.focusSink();
  }

  /* ------------------------------------------------------------------ hover */

  private updateHover(x: number, y: number): void {
    const hit = this.hitTest(x, y);
    const ui = useUI.getState();
    let cursor = 'cell';
    let hover: GridController['hover'] = null;
    let cell: CellPos | null = null;
    if (hit.area === 'corner') {
      hover = { kind: 'corner', index: 0 };
      cursor = 'pointer';
    } else if (hit.area === 'col') {
      hover = { kind: 'col', index: hit.index };
      cursor = hit.resize !== null ? 'col-resize' : COL_CURSOR;
    } else if (hit.area === 'row') {
      hover = { kind: 'row', index: hit.index };
      cursor = hit.resize !== null ? 'row-resize' : ROW_CURSOR;
    } else {
      cell = { r: hit.r, c: hit.c };
      if (hit.part === 'fill') cursor = 'crosshair';
      else if (hit.part === 'border') cursor = 'move';
      else if (hit.part === 'filter' || hit.part === 'checkbox') cursor = 'pointer';
      else if (ui.painter) cursor = 'copy';
      const note = this.sheet.cells.get(cellKey(hit.r, hit.c))?.note;
      const same = this.hoverNote && this.hoverNote.r === hit.r && this.hoverNote.c === hit.c;
      if (!same) {
        clearTimeout(this.hoverTimer);
        if (this.hoverNote) this.setHoverNote(null);
        if (note && !ui.noteEditor) {
          const at = { r: hit.r, c: hit.c };
          this.hoverTimer = window.setTimeout(() => this.setHoverNote(at), 250);
        }
      }
    }
    if (hit.area !== 'cell') {
      clearTimeout(this.hoverTimer);
      this.setHoverNote(null);
    }
    this.overlay.style.cursor = cursor;
    const headerChanged = this.hover?.kind !== hover?.kind || this.hover?.index !== hover?.index;
    const cellChanged = this.hoverCell?.r !== cell?.r || this.hoverCell?.c !== cell?.c;
    this.hover = hover;
    this.hoverCell = cell;
    if (headerChanged) this.invalidate();
    else if (cellChanged) this.drawOverlayLayer();
  }

  private setHoverNote(at: CellPos | null): void {
    if (this.hoverNote === at) return;
    this.hoverNote = at;
    this.frame++;
    for (const fn of this.listeners) fn();
  }

  private clearHover(): void {
    if (this.drag) return;
    clearTimeout(this.hoverTimer);
    this.setHoverNote(null);
    if (!this.hover && !this.hoverCell) return;
    this.hover = null;
    this.hoverCell = null;
    this.invalidate();
  }

}

function moveTarget(d: Extract<Drag, { kind: 'move' }>): Range {
  return { r1: d.to.r, c1: d.to.c, r2: d.to.r + d.source.r2 - d.source.r1, c2: d.to.c + d.source.c2 - d.source.c1 };
}

const arrow = (path: string): string =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18'><path d='${path}' fill='#1b2333' stroke='#fff' stroke-width='1.2'/></svg>`)}") 9 9, default`;
const COL_CURSOR = arrow('M8 2h2v9h3l-4 5-4-5h3z');
const ROW_CURSOR = arrow('M2 8v2h9v3l5-4-5-4v3z');

/* Used extent is needed every frame, so it is cached per cell-map state. */
let extentFor: Sheet | null = null;
let extentRange_: Range = { r1: 0, c1: 0, r2: 0, c2: 0 };

function extentCache(sheet: Sheet): Range {
  if (extentFor !== sheet) {
    extentFor = sheet;
    extentRange_ = extentRange(sheet);
  }
  return extentRange_;
}
