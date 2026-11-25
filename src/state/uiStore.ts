import { create } from 'zustand';
import type { ClipData } from '@/engine/commands/clipboard';
import type { FindHit } from '@/engine/commands/find';
import type { CellPos, Range, SelectionState } from '@/types';
import { uid } from '@/utils/id';
import { prefs } from './storage';

export type RibbonTab = 'home' | 'insert' | 'data' | 'formulas' | 'review' | 'view' | 'help';
export type ThemeMode = 'light' | 'dark' | 'system';

export interface PointState {
  /** Text span of the reference being pointed at. */
  start: number;
  end: number;
  anchor: CellPos;
  focus: CellPos;
  sheetId: string;
}

export interface EditState {
  sheetId: string;
  r: number;
  c: number;
  text: string;
  /** `enter`: arrows commit and move. `edit`: arrows move the caret. */
  mode: 'enter' | 'edit';
  /** Which input has focus. */
  origin: 'cell' | 'bar';
  caretStart: number;
  caretEnd: number;
  /** Bumped when code (not the user) changed the text, so inputs re-apply the caret. */
  stamp: number;
  point: PointState | null;
}

export type DialogState =
  | { type: 'find'; replace: boolean }
  | { type: 'conditional'; preset?: string; ruleId?: string }
  | { type: 'validation' }
  | { type: 'sort' }
  | { type: 'names'; create?: boolean }
  | { type: 'function'; category?: string }
  | { type: 'link' }
  | { type: 'duplicates' }
  | { type: 'split' }
  | { type: 'size'; axis: 'row' | 'col' }
  | { type: 'format'; tab?: string }
  | { type: 'shortcuts' }
  | { type: 'about' }
  | { type: 'share' }
  | { type: 'pdf' }
  | { type: 'stats' }
  | { type: 'shift'; mode: 'insert' | 'delete' }
  | { type: 'sparkline'; kind: 'line' | 'column' | 'winloss' }
  | { type: 'goto' }
  | { type: 'table'; styleId: string }
  | {
      type: 'confirm';
      title: string;
      message: string;
      confirmLabel: string;
      danger?: boolean;
      cancelLabel?: string;
      onConfirm: () => void;
      onCancel?: () => void;
    };

export type PanelState = { type: 'chart'; chartId: string } | { type: 'conditional' } | { type: 'notes' } | { type: 'history' } | null;

export type ContextMenuState =
  | { type: 'cell'; x: number; y: number }
  | { type: 'row'; x: number; y: number }
  | { type: 'col'; x: number; y: number }
  | { type: 'sheet'; x: number; y: number; sheetId: string }
  | { type: 'chart'; x: number; y: number; chartId: string }
  | null;

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error';
  text: string;
  action?: { label: string; run: () => void };
}

export interface TraceState {
  sheetId: string;
  from: CellPos;
  ranges: Range[];
  kind: 'precedents' | 'dependents';
}

interface UIState {
  activeSheetId: string;
  selections: Record<string, SelectionState>;
  scrolls: Record<string, { x: number; y: number }>;
  edit: EditState | null;
  clip: ClipData | null;
  /** Dashed outline around copied cells. */
  marquee: { sheetId: string; range: Range } | null;
  painter: { sheetId: string; range: Range; sticky: boolean } | null;
  selectedChart: string | null;
  ribbonTab: RibbonTab;
  ribbonOpen: boolean;
  theme: ThemeMode;
  dark: boolean;
  showFormulaBar: boolean;
  formulaBarTall: boolean;
  showHeadings: boolean;
  showFormulas: boolean;
  circleInvalid: boolean;
  backstage: 'home' | 'new' | 'open' | 'export' | 'info' | null;
  palette: boolean;
  dialog: DialogState | null;
  panel: PanelState;
  menu: ContextMenuState;
  filterMenu: { col: number; x: number; y: number } | null;
  listMenu: { r: number; c: number } | null;
  noteEditor: { sheetId: string; r: number; c: number } | null;
  toasts: Toast[];
  busy: string | null;
  found: { hits: FindHit[]; index: number } | null;
  traces: TraceState[];
  renamingSheet: string | null;
  set(patch: Partial<UIState>): void;
  toast(kind: Toast['kind'], text: string, action?: Toast['action']): void;
  dismissToast(id: string): void;
  setTheme(theme: ThemeMode): void;
}

const prefersDark = (): boolean => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;

function resolveDark(theme: ThemeMode): boolean {
  return theme === 'dark' || (theme === 'system' && prefersDark());
}

const initialTheme = prefs.get('theme', 'light') as ThemeMode;

export const DEFAULT_SELECTION: SelectionState = { active: { r: 0, c: 0 }, ranges: [{ r1: 0, c1: 0, r2: 0, c2: 0 }] };

export const useUI = create<UIState>((set, get) => ({
  activeSheetId: '',
  selections: {},
  scrolls: {},
  edit: null,
  clip: null,
  marquee: null,
  painter: null,
  selectedChart: null,
  ribbonTab: 'home',
  ribbonOpen: prefs.get('ribbon', 'open') === 'open',
  theme: initialTheme,
  dark: resolveDark(initialTheme),
  showFormulaBar: true,
  formulaBarTall: false,
  showHeadings: true,
  showFormulas: false,
  circleInvalid: false,
  backstage: null,
  palette: false,
  dialog: null,
  panel: null,
  menu: null,
  filterMenu: null,
  listMenu: null,
  noteEditor: null,
  toasts: [],
  busy: null,
  found: null,
  traces: [],
  renamingSheet: null,

  set(patch) {
    set(patch);
  },

  toast(kind, text, action) {
    const id = uid('t');
    set((s) => ({ toasts: [...s.toasts.filter((t) => t.text !== text).slice(-3), { id, kind, text, action }] }));
    setTimeout(() => get().dismissToast(id), action ? 8000 : kind === 'error' ? 6000 : 3200);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  setTheme(theme) {
    prefs.set('theme', theme);
    const dark = resolveDark(theme);
    document.documentElement.classList.toggle('dark', dark);
    set({ theme, dark });
  },
}));

if (typeof matchMedia !== 'undefined') {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const { theme, setTheme } = useUI.getState();
    if (theme === 'system') setTheme('system');
  });
}
