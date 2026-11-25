import { useEffect, useRef, useState } from 'react';
import { cellName } from '@/engine/address';
import { displayText } from '@/engine/validation';
import { mountGridApi } from '@/state/gridApi';
import { useActiveSheet, useSelection } from '@/state/selectors';
import { useWorkbook } from '@/state/workbookStore';
import { ChartLayer } from '../charts/ChartLayer';
import { CellEditor } from './CellEditor';
import { FilterMenu } from './FilterMenu';
import { GridController } from './GridController';
import { GridOverlays } from './GridOverlays';

/** The spreadsheet surface: canvas, editor, charts and overlays. */
export function GridView() {
  const scroller = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const editor = useRef<{ focus(): void }>(null);
  const [controller, setController] = useState<GridController | null>(null);

  useEffect(() => {
    const focus = (): void => editor.current?.focus();
    const c = new GridController(scroller.current!, spacer.current!, stage.current!, canvas.current!, overlay.current!, focus);
    setController(c);
    const unmount = mountGridApi({
      focus,
      reveal: (r, col) => c.reveal(r, col),
      cellRect: (r, col) => c.pageRect(r, col),
      pageRows: () => c.pageRows(),
      pageCols: () => c.pageCols(),
      center: () => c.center(),
      viewportSize: () => c.viewportSize(),
    });
    return () => {
      unmount();
      c.destroy();
      setController(null);
    };
  }, []);

  useEffect(() => {
    if (controller) editor.current?.focus();
  }, [controller]);

  return (
    <div className="relative min-h-0 flex-1 bg-chrome" role="region" aria-label="Spreadsheet">
      <div ref={scroller} className="grid-scroller absolute inset-0 overflow-scroll" tabIndex={-1}>
        <div ref={spacer}>
          <div ref={stage} className="sticky left-0 top-0 overflow-hidden">
            <canvas ref={canvas} className="absolute left-0 top-0" aria-hidden="true" />
            <canvas ref={overlay} className="absolute left-0 top-0" style={{ touchAction: 'pan-x pan-y' }} aria-hidden="true" />
            {controller && (
              <>
                <ChartLayer controller={controller} />
                <GridOverlays controller={controller} />
                <CellEditor controller={controller} ref={editor} />
              </>
            )}
          </div>
        </div>
      </div>
      <FilterMenu />
      <ActiveCellAnnouncer />
    </div>
  );
}

/** Tells screen readers about the active cell, since the grid itself is a canvas. */
function ActiveCellAnnouncer() {
  const sheet = useActiveSheet();
  const { active } = useSelection();
  const engine = useWorkbook((s) => s.engine);
  const revision = useWorkbook((s) => s.revision);
  void revision;
  const text = displayText(sheet, engine, active.r, active.c);
  return (
    <div className="sr-only" aria-live="polite">
      {cellName(active.r, active.c)}, {text || 'empty'}
    </div>
  );
}
