/** Autocomplete state shared by the cell editor and the formula bar. */
import { create } from 'zustand';
import { tableAt } from '@/engine/commands/data';
import { keyCol, keyRow } from '@/engine/address';
import { allFunctions, type FunctionDef } from '@/formulas';
import { editReplace } from '@/state/editing';
import { sheetById } from '@/state/selectors';
import { useUI, type EditState } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import { wordAt } from './formulaRefs';

export type Suggestion =
  | { kind: 'function'; name: string; def: FunctionDef }
  | { kind: 'name'; name: string; detail: string }
  | { kind: 'value'; name: string };

interface AssistState {
  index: number;
  /** True once the user moved through the list, so Enter accepts. */
  navigated: boolean;
  /** Text for which the list was dismissed. */
  dismissed: string | null;
  set(patch: Partial<Omit<AssistState, 'set'>>): void;
}

export const useAssist = create<AssistState>((set) => ({
  index: 0,
  navigated: false,
  dismissed: null,
  set: (p) => set(p),
}));

const COMMON = ['SUM', 'AVERAGE', 'IF', 'COUNT', 'MAX', 'MIN', 'XLOOKUP', 'VLOOKUP', 'SUMIFS', 'COUNTIFS', 'IFERROR', 'INDEX', 'MATCH', 'ROUND', 'TEXT', 'DATE', 'TODAY', 'CONCAT', 'FILTER', 'SORT', 'UNIQUE'];

/** Text previously typed in the same column, for plain-value completion. */
function columnValue(edit: EditState): Suggestion[] {
  if (edit.text.length < 1 || edit.mode !== 'enter' || edit.caretStart !== edit.text.length) return [];
  if (/^[\d=+\-'.]/.test(edit.text)) return [];
  const sheet = sheetById(useWorkbook.getState().workbook, edit.sheetId);
  if (sheet.cells.size > 40_000) return [];
  const lower = edit.text.toLowerCase();
  const found = new Map<string, number>();
  for (const [key, cell] of sheet.cells) {
    if (keyCol(key) !== edit.c || typeof cell.v !== 'string') continue;
    const r = keyRow(key);
    if (r === edit.r || Math.abs(r - edit.r) > 200) continue;
    const { v } = cell;
    if (v.length > edit.text.length && v.toLowerCase().startsWith(lower)) found.set(v, Math.min(found.get(v) ?? Infinity, Math.abs(r - edit.r)));
  }
  if (found.size !== 1 && !tableAt(sheet, edit.r, edit.c)) return [];
  return [...found].sort((a, b) => a[1] - b[1]).slice(0, 5).map(([name]) => ({ kind: 'value', name }));
}

export function suggestionsFor(edit: EditState | null): Suggestion[] {
  if (!edit || edit.caretStart !== edit.caretEnd || edit.point) return [];
  if (useAssist.getState().dismissed === edit.text) return [];
  if (!edit.text.startsWith('=')) return columnValue(edit);
  const w = wordAt(edit.text, edit.caretStart);
  if (!w) return [];
  const upper = w.word.toUpperCase();
  const fns = allFunctions()
    .filter((f) => f.name.startsWith(upper))
    .sort((a, b) => {
      const ia = COMMON.indexOf(a.name);
      const ib = COMMON.indexOf(b.name);
      if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return a.name < b.name ? -1 : 1;
    })
    .slice(0, 40)
    .map((def): Suggestion => ({ kind: 'function', name: def.name, def }));
  const names = useWorkbook
    .getState()
    .workbook.names.filter((n) => n.name.toUpperCase().startsWith(upper))
    .map((n): Suggestion => ({ kind: 'name', name: n.name, detail: n.ref }));
  return [...names, ...fns];
}

export function acceptSuggestion(s: Suggestion): void {
  const { edit } = useUI.getState();
  if (!edit) return;
  useAssist.getState().set({ index: 0, navigated: false });
  if (s.kind === 'value') {
    editReplace(s.name, s.name.length);
    return;
  }
  const w = wordAt(edit.text, edit.caretStart);
  if (!w) return;
  const insert = s.kind === 'function' ? `${s.name}(` : s.name;
  const after = edit.text.slice(edit.caretStart);
  const text = edit.text.slice(0, w.start) + insert + after;
  editReplace(text, w.start + insert.length);
}

/** Handles list keys. Returns true when the key was used. */
export function assistKey(key: string): boolean {
  const { edit } = useUI.getState();
  const items = suggestionsFor(edit);
  if (!items.length) return false;
  const st = useAssist.getState();
  const index = Math.min(st.index, items.length - 1);
  const isValue = items[0].kind === 'value';
  switch (key) {
    case 'ArrowDown':
      if (isValue) return false;
      st.set({ index: (index + 1) % items.length, navigated: true });
      return true;
    case 'ArrowUp':
      if (isValue) return false;
      st.set({ index: (index - 1 + items.length) % items.length, navigated: true });
      return true;
    case 'Tab':
      if (isValue) return false;
      acceptSuggestion(items[index]);
      return true;
    case 'Enter':
      if (!st.navigated || isValue) return false;
      acceptSuggestion(items[index]);
      return true;
    case 'ArrowRight':
      if (!isValue) return false;
      acceptSuggestion(items[0]);
      return true;
    case 'Escape':
      st.set({ dismissed: edit!.text, index: 0, navigated: false });
      return !isValue;
    default:
      return false;
  }
}
