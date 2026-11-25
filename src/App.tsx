import { useEffect, useState } from 'react';
import { BusyOverlay, Toasts, TooltipLayer } from '@/components/Feedback';
import { AppBar } from '@/features/appBar/AppBar';
import { Logo } from '@/features/appBar/Logo';
import { Backstage } from '@/features/backstage/Backstage';
import { SAMPLE_CELL, salesWorkbook } from '@/features/backstage/sample';
import { Dialogs } from '@/features/dialogs/Dialogs';
import { FormulaBar } from '@/features/formulaBar/FormulaBar';
import { GridView } from '@/features/grid/GridView';
import { handleShortcut } from '@/features/grid/keyboard';
import { openFile, startWorkbook } from '@/features/io/fileActions';
import { workbookFromUrl } from '@/features/io/share';
import { ContextMenus } from '@/features/menus/ContextMenus';
import { SelectionToolbar } from '@/features/menus/MiniToolbar';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { Panels } from '@/features/panels/Panels';
import { RibbonBody, RibbonTabs } from '@/features/ribbon/Ribbon';
import { SheetTabs } from '@/features/sheetTabs/SheetTabs';
import { StatusBar } from '@/features/statusBar/StatusBar';
import { gridApi } from '@/state/gridApi';
import { restoreLast, startAutosave } from '@/state/persistence';
import { useUI } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import { APP_NAME } from '@/utils/brand';
import { cx } from '@/utils/cx';

let booted = false;

async function boot(): Promise<void> {
  if (booted) return;
  booted = true;
  // Canvas text needs the font before the first paint.
  await Promise.race([
    Promise.all([400, 450, 600].map((w) => document.fonts.load(`${w} 13px "IBM Plex Sans Variable"`))),
    new Promise((r) => setTimeout(r, 1200)),
  ]).catch(() => undefined);
  await restoreLast(salesWorkbook, SAMPLE_CELL);
  startAutosave();
  try {
    const shared = await workbookFromUrl();
    if (shared) {
      await startWorkbook(shared);
      useUI.getState().toast('success', `Opened your copy of ${shared.name}.`);
    }
  } catch {
    useUI.getState().toast('error', 'This share link is incomplete or damaged. Ask for a new link.');
  }
}

const isTextField = (el: Element | null): boolean => el instanceof HTMLElement && (el.isContentEditable || el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'button'].includes(el.type)) || el instanceof HTMLSelectElement);

/** Keyboard shortcuts and focus return that apply to the whole window. */
function useGlobalInput(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || isTextField(document.activeElement)) return;
      const ui = useUI.getState();
      if (ui.backstage || ui.palette || (ui.dialog && ui.dialog.type !== 'find')) return;
      if (handleShortcut(e)) e.preventDefault();
    };
    // When a focused control disappears, focus goes back to the grid.
    const onRelease = (): void => {
      requestAnimationFrame(() => {
        const ui = useUI.getState();
        if (document.activeElement !== document.body || ui.dialog || ui.backstage || ui.palette || ui.menu || ui.renamingSheet) return;
        if (document.querySelector('[data-floating]')) return;
        gridApi.focus();
      });
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerup', onRelease);
    window.addEventListener('keyup', onRelease);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerup', onRelease);
      window.removeEventListener('keyup', onRelease);
    };
  }, []);
}

/** Files can be dropped anywhere on the window. */
function useFileDrop(): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFile = (e: DragEvent): boolean => [...(e.dataTransfer?.types ?? [])].includes('Files');
    const enter = (e: DragEvent): void => {
      if (!hasFile(e)) return;
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent): void => {
      if (!hasFile(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const move = (e: DragEvent): void => {
      if (hasFile(e)) e.preventDefault();
    };
    const drop = (e: DragEvent): void => {
      depth = 0;
      setOver(false);
      if (!hasFile(e) || e.defaultPrevented) return;
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (file) void openFile(file);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', move);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', move);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return over;
}

export function App() {
  const ready = useWorkbook((s) => s.ready);
  const name = useWorkbook((s) => s.workbook.name);
  const showFormulaBar = useUI((s) => s.showFormulaBar);
  const dropping = useFileDrop();
  useGlobalInput();

  useEffect(() => void boot(), []);
  useEffect(() => {
    if (ready) document.title = `${name} - ${APP_NAME}`;
  }, [ready, name]);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-frame" role="status" aria-label={`Loading ${APP_NAME}`}>
        <span className="animate-pulse">
          <Logo size={44} />
        </span>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <AppBar />
      <RibbonTabs />
      <RibbonBody />
      <div className={cx('mt-2 flex min-h-0 flex-1 flex-col border-t border-line bg-panel')}>
        {showFormulaBar && <FormulaBar />}
        <div className="relative flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <GridView />
            <SheetTabs />
          </div>
          <Panels />
        </div>
        <StatusBar />
      </div>
      <Backstage />
      <ContextMenus />
      <SelectionToolbar />
      <Dialogs />
      <CommandPalette />
      <Toasts />
      <BusyOverlay />
      <TooltipLayer />
      {dropping && (
        <div className="pointer-events-none fixed inset-3 z-[88] flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-accent-soft/85">
          <p className="text-lg font-semibold text-accent">Drop to open</p>
        </div>
      )}
    </div>
  );
}
