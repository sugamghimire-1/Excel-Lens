import { Settings2 } from 'lucide-react';
import { useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { colAxis, rowAxis } from '@/engine/axis';
import { updateChart } from '@/state/actions';
import { settleEdit } from '@/state/editing';
import { gridApi } from '@/state/gridApi';
import { useActiveSheet } from '@/state/selectors';
import { useUI } from '@/state/uiStore';
import type { ChartModel } from '@/types';
import { cx } from '@/utils/cx';
import type { GridController } from '../grid/GridController';
import type { Pane } from '../grid/viewport';
import { ChartView } from './ChartView';

type Rect = Pick<ChartModel, 'x' | 'y' | 'w' | 'h'>;

const HANDLES = [
  ['nw', 'left-0 top-0 cursor-nwse-resize'],
  ['n', 'left-1/2 top-0 cursor-ns-resize'],
  ['ne', 'left-full top-0 cursor-nesw-resize'],
  ['e', 'left-full top-1/2 cursor-ew-resize'],
  ['se', 'left-full top-full cursor-nwse-resize'],
  ['s', 'left-1/2 top-full cursor-ns-resize'],
  ['sw', 'left-0 top-full cursor-nesw-resize'],
  ['w', 'left-0 top-1/2 cursor-ew-resize'],
] as const;

const MIN_W = 180;
const MIN_H = 120;

export function ChartLayer({ controller }: { controller: GridController }) {
  useSyncExternalStore(controller.subscribe, controller.getFrame);
  const sheet = useActiveSheet();
  if (!controller.layout || sheet.charts.length === 0) return null;
  const { panes, frozenW, frozenH, view } = controller.layout;
  const paneOf = (c: ChartModel): Pane => {
    const left = c.x < frozenW;
    const top = c.y < frozenH;
    const id = left && top ? 'corner' : top ? 'top' : left ? 'left' : 'main';
    return panes.find((p) => p.id === id) ?? panes[0];
  };
  return (
    <>
      {panes.map((pane) => {
        const charts = sheet.charts.filter((c) => paneOf(c).id === pane.id);
        if (!charts.length) return null;
        return (
          // Charts anchored in a frozen area may extend past it, so only the outer edges clip.
          <div key={pane.id} className={cx('pointer-events-none absolute overflow-hidden', pane.id === 'main' ? 'z-10' : 'z-[11]')} style={{ left: pane.x, top: pane.y, width: view.width - pane.x, height: view.height - pane.y }}>
            {charts.map((c) => {
              const visible = (c.x + c.w - pane.sx) * view.zoom > -400 && (c.x - pane.sx) * view.zoom < pane.w + 400 && (c.y + c.h - pane.sy) * view.zoom > -600 && (c.y - pane.sy) * view.zoom < pane.h + 600;
              return visible ? <ChartFrame key={c.id} chart={c} pane={pane} zoom={view.zoom} /> : null;
            })}
          </div>
        );
      })}
    </>
  );
}

function ChartFrame({ chart, pane, zoom }: { chart: ChartModel; pane: Pane; zoom: number }) {
  const sheet = useActiveSheet();
  const selected = useUI((s) => s.selectedChart === chart.id);
  const [live, setLive] = useState<Rect | null>(null);
  const drag = useRef<{ px: number; py: number; rect: Rect; handle: string | null; moved: boolean } | null>(null);
  const rect = live ?? chart;

  const select = (): void => {
    if (!settleEdit()) return;
    const { panel, set } = useUI.getState();
    set({ selectedChart: chart.id, menu: null, panel: panel?.type === 'chart' ? { type: 'chart', chartId: chart.id } : panel });
    gridApi.focus();
  };

  const down = (e: ReactPointerEvent<HTMLElement>, handle: string | null): void => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    select();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, rect: { x: chart.x, y: chart.y, w: chart.w, h: chart.h }, handle, moved: false };
  };

  const moveTo = (e: ReactPointerEvent<HTMLElement>): void => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.px) / zoom;
    const dy = (e.clientY - d.py) / zoom;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    d.moved = true;
    const next = { ...d.rect };
    const snapX = (v: number): number => (e.altKey ? colAxis(sheet).offset(colAxis(sheet).indexAt(v + 20)) : v);
    const snapY = (v: number): number => (e.altKey ? rowAxis(sheet).offset(rowAxis(sheet).indexAt(v + 10)) : v);
    if (!d.handle) {
      next.x = Math.max(0, Math.round(snapX(d.rect.x + dx)));
      next.y = Math.max(0, Math.round(snapY(d.rect.y + dy)));
    } else {
      if (d.handle.includes('e')) next.w = Math.max(MIN_W, Math.round(snapX(d.rect.x + d.rect.w + dx) - d.rect.x));
      if (d.handle.includes('s')) next.h = Math.max(MIN_H, Math.round(snapY(d.rect.y + d.rect.h + dy) - d.rect.y));
      if (d.handle.includes('w')) {
        const x = Math.max(0, Math.min(d.rect.x + d.rect.w - MIN_W, Math.round(snapX(d.rect.x + dx))));
        next.w = d.rect.x + d.rect.w - x;
        next.x = x;
      }
      if (d.handle.includes('n')) {
        const y = Math.max(0, Math.min(d.rect.y + d.rect.h - MIN_H, Math.round(snapY(d.rect.y + dy))));
        next.h = d.rect.y + d.rect.h - y;
        next.y = y;
      }
    }
    setLive(next);
  };

  const up = (): void => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved && live) updateChart(chart.id, live, d.handle ? 'Resize chart' : 'Move chart');
    setLive(null);
  };

  return (
    <div
      className={cx('pointer-events-auto absolute rounded-lg border bg-panel', selected ? 'z-10 border-accent shadow-pop' : 'border-line shadow-card', live && 'opacity-95')}
      style={{ left: (rect.x - pane.sx) * zoom, top: (rect.y - pane.sy) * zoom, width: rect.w * zoom, height: rect.h * zoom, cursor: 'move' }}
      onPointerDown={(e) => down(e, null)}
      onPointerMove={moveTo}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => useUI.getState().set({ selectedChart: chart.id, panel: { type: 'chart', chartId: chart.id } })}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        select();
        useUI.getState().set({ menu: { type: 'chart', x: e.clientX, y: e.clientY, chartId: chart.id } });
      }}
    >
      <div className="h-full w-full overflow-hidden rounded-lg">
        <ChartView chart={chart} sheet={sheet} zoom={zoom} />
      </div>
      {selected && (
        <>
          <button
            type="button"
            aria-label="Chart settings"
            data-tip="Chart settings"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => useUI.getState().set({ panel: { type: 'chart', chartId: chart.id } })}
            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-raised text-ink-2 shadow-card hover:bg-hover hover:text-ink"
          >
            <Settings2 size={15} />
          </button>
          {HANDLES.map(([id, pos]) => (
            <span
              key={id}
              onPointerDown={(e) => down(e, id)}
              onPointerMove={moveTo}
              onPointerUp={up}
              onPointerCancel={up}
              className={cx('absolute h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-[1.5px] border-accent bg-panel', pos)}
            />
          ))}
        </>
      )}
    </div>
  );
}
