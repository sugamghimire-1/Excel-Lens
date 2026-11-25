/** Autosave, opening and cross-tab notices. */
import { cellRange, parseCellName } from '@/engine/address';
import type { Workbook } from '@/types';
import { prefs, storage, type WorkbookMeta } from './storage';
import { useUI } from './uiStore';
import { useWorkbook } from './workbookStore';

const AUTOSAVE_DELAY = 700;
let timer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> | null = null;
let channel: BroadcastChannel | null = null;

/** Writes the current workbook now. Concurrent calls share one write. */
export async function saveNow(): Promise<void> {
  clearTimeout(timer);
  if (saving) await saving;
  const { workbook, revision, setSaveState } = useWorkbook.getState();
  setSaveState('saving');
  saving = storage
    .save(workbook)
    .then(() => {
      prefs.set('last', workbook.id);
      const now = useWorkbook.getState();
      setSaveState(now.revision === revision ? 'saved' : 'unsaved');
      channel?.postMessage({ type: 'saved', id: workbook.id });
    })
    .catch((e: unknown) => {
      setSaveState('error');
      useUI.getState().toast('error', `Could not save to this browser: ${e instanceof Error ? e.message : 'storage is unavailable'}. Download a copy to keep your work.`);
    })
    .finally(() => {
      saving = null;
    });
  await saving;
}

/** Opens a workbook, optionally with a cell selected on its first sheet. */
export function openWorkbook(workbook: Workbook, cell?: string): void {
  useWorkbook.getState().load(workbook);
  const first = workbook.sheets.find((s) => !s.hidden) ?? workbook.sheets[0];
  const start = cell ? parseCellName(cell) : null;
  useUI.getState().set({
    activeSheetId: first.id,
    selections: start ? { [first.id]: { active: { r: start.r, c: start.c }, ranges: [cellRange(start.r, start.c)] } } : {},
    scrolls: {},
    edit: null,
    clip: null,
    marquee: null,
    painter: null,
    selectedChart: null,
    panel: null,
    dialog: null,
    menu: null,
    found: null,
    traces: [],
    backstage: null,
    circleInvalid: false,
  });
  prefs.set('last', workbook.id);
}

export async function openStored(meta: WorkbookMeta): Promise<void> {
  const ui = useUI.getState();
  ui.set({ busy: `Opening ${meta.name}` });
  try {
    if (useWorkbook.getState().saveState === 'unsaved') await saveNow();
    const wb = await storage.load(meta.id);
    if (!wb) throw new Error('It is no longer stored in this browser.');
    openWorkbook(wb);
  } catch (e) {
    ui.toast('error', `Could not open ${meta.name}. ${e instanceof Error ? e.message : ''}`);
  } finally {
    ui.set({ busy: null });
  }
}

/** Loads the last workbook, or the sample on first run. */
export async function restoreLast(sample: () => Workbook, cell: string): Promise<void> {
  try {
    const last = prefs.get('last', '');
    const wb = last ? await storage.load(last) : null;
    if (wb) {
      openWorkbook(wb);
      return;
    }
  } catch {
    // Storage is unavailable (private window, blocked cookies): start fresh.
  }
  openWorkbook(sample(), cell);
  useWorkbook.setState({ saveState: 'unsaved' });
  void saveNow();
}

/** Starts autosave. Call once. */
export function startAutosave(): void {
  let last = useWorkbook.getState().revision;
  useWorkbook.subscribe((s) => {
    if (s.revision === last) return;
    last = s.revision;
    if (s.saveState !== 'unsaved') return;
    clearTimeout(timer);
    timer = setTimeout(() => void saveNow(), AUTOSAVE_DELAY);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && useWorkbook.getState().saveState === 'unsaved') void saveNow();
  });
  window.addEventListener('beforeunload', (e) => {
    if (useWorkbook.getState().saveState === 'unsaved' || useWorkbook.getState().saveState === 'error') e.preventDefault();
  });
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('excel-lens');
    channel.onmessage = (e: MessageEvent<{ type: string; id: string }>) => {
      const { workbook } = useWorkbook.getState();
      if (e.data.type !== 'saved' || e.data.id !== workbook.id) return;
      useUI.getState().toast('info', 'This workbook was changed in another tab.', {
        label: 'Load changes',
        run: () => {
          void storage.load(workbook.id).then((wb) => wb && openWorkbook(wb));
        },
      });
    };
  }
}
